// Producing and checking the redacted PDF. Kept free of worker and browser
// globals so that the same code runs in the PDF worker and in the tests.
//
// A redacted PDF must not contain what was redacted - anywhere. Painting a
// black box is the smallest part of that: the same name can sit in a bookmark,
// in the document properties, in an attachment, in a page thumbnail or in an
// object an editor left behind. `exportDocument` removes those places as well,
// and `verifyExport` opens the result again and looks for what should be gone.
import * as mupdf from 'mupdf'
import type { PDFDocument, PDFObject, PDFPage } from 'mupdf'

export interface ExportAnnotation {
  content: string
  position: { pageNumber: number; rect: number[]; quads: number[][] }
}

export interface ExportOptions {
  // false: a preview with marked areas for internal review, nothing removed.
  apply: boolean
  // Keys of the document information dictionary to delete (Author, Title, ...).
  fieldsToRemove: string[]
  // Written as the Producer of the exported file.
  producerLabel: string
}

// One redacted area and the text that stood in it before the export.
export interface RedactedArea {
  pageIndex: number
  quads: number[][]
  text: string
}

// What the export took out besides the redacted areas themselves.
export interface Removed {
  attachments: number
  scripts: number
  bookmarks: number
  links: number
  thumbnails: number
  comments: number
  formFields: number
  documentProperties: string[]
  xmpMetadata: boolean
  structureTree: boolean
  privateData: number
}

export interface ExportResult {
  pdf: Uint8Array
  areas: RedactedArea[]
  removed: Removed
}

export type ProblemKind =
  | 'text-under-redaction'   // text can still be extracted from a redacted area
  | 'term-in-document-data'  // redacted text found outside the page content
  | 'attachment' | 'script' | 'bookmark' | 'xmp-metadata' | 'thumbnail' | 'form-field' | 'comment'
  | 'document-property' | 'earlier-version'

export interface Problem {
  kind: ProblemKind
  pageIndex?: number
  detail?: string
}

// Redacted text that still stands, readable, somewhere it was not redacted.
// That can be intended, so it is reported without failing the export.
export interface RemainingMention {
  text: string
  pageIndexes: number[]
}

export interface ExportReport {
  ok: boolean
  redactedAreas: number
  problems: Problem[]
  remainingMentions: RemainingMention[]
  removed: Removed
}

// A stretch of text that is in the file but cannot be seen on the page.
export interface InvisibleText {
  text: string
  quads: number[][]
}

type Box = { x0: number; y0: number; x1: number; y1: number }

// The reason given to suggestions for text that cannot be seen on the page.
// Like the other built-in reasons it is stored with the redaction as written.
export const INVISIBLE_TEXT_REASON = 'Unsichtbarer Text'

// Shorter strings are too likely to match by accident ("Dr", "am", a page number).
const MIN_TERM_LENGTH = 4

const quadBox = (q: number[]): Box => ({
  x0: Math.min(q[0], q[2], q[4], q[6]), y0: Math.min(q[1], q[3], q[5], q[7]),
  x1: Math.max(q[0], q[2], q[4], q[6]), y1: Math.max(q[1], q[3], q[5], q[7]),
})
const intersects = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
// Letters and digits only, so that "Lena Hoffmann" is also recognised in
// "lena.hoffmann@example.de" or "Hoffmann, Lena".
const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= MIN_TERM_LENGTH)

interface Char { c: string; box: Box; size: number }

// Every character of a page with its position, in reading order, with a space
// between words and a line break between lines.
function pageChars(page: PDFPage): Char[] {
  const chars: Char[] = []
  page.toStructuredText('preserve-whitespace').walk({
    onChar(c, _origin, _font, size, quad) {
      chars.push({ c, box: quadBox(quad as unknown as number[]), size })
    },
    endLine() {
      chars.push({ c: '\n', box: { x0: 0, y0: 0, x1: 0, y1: 0 }, size: 0 })
    },
  })
  return chars
}

// The text whose characters lie (by their centre) inside one of the boxes.
function textInside(chars: Char[], boxes: Box[]): string {
  let text = ''
  for (const { c, box } of chars) {
    if (c === '\n') { text += ' '; continue }
    const cx = (box.x0 + box.x1) / 2
    const cy = (box.y0 + box.y1) / 2
    if (boxes.some(b => cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1)) text += c
  }
  return text.replace(/\s+/g, ' ').trim()
}

function countOutline(items: ReturnType<PDFDocument['loadOutline']>): number {
  if (!items) return 0
  return items.reduce((n, item) => n + 1 + countOutline(item.down ?? null), 0)
}

function isJavaScriptAction(obj: PDFObject): boolean {
  if (!obj || obj.isNull() || !obj.isDictionary()) return false
  const kind = obj.get('S')
  return !kind.isNull() && kind.asName() === 'JavaScript'
}

// Deleting an annotation invalidates the others in the list it came from, so
// the list is read again after each deletion; deleting while walking one list
// leaves every second annotation in place.
function deleteAllAnnotations(page: PDFPage): number {
  let deleted = 0
  for (let list = page.getAnnotations(); list.length; list = page.getAnnotations()) {
    page.deleteAnnotation(list[0])
    deleted++
  }
  return deleted
}

// A marking found in a file when it is opened: the areas it covers and its note.
export interface ExistingMarking {
  pageIndex: number
  quads: number[][]
  content: string
}

/**
 * Takes every comment and marking out of a freshly opened document and returns
 * those that cover an area of the page (redaction marks, highlights and the
 * like), so that they can be offered as redactions. Notes, stamps and other
 * kinds have no such area; they are removed without being returned.
 */
export function takeAnnotations(doc: PDFDocument): ExistingMarking[] {
  const markings: ExistingMarking[] = []
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i)
    const annotations = page.getAnnotations()
    for (const annotation of annotations) {
      let quads: number[][] = []
      // Only some kinds of annotation have quad points; asking the others fails.
      try { quads = annotation.getQuadPoints() as unknown as number[][] } catch { /* no area */ }
      if (quads.length) markings.push({ pageIndex: i, quads, content: annotation.getContents() })
    }
    deleteAllAnnotations(page)
  }
  return markings
}

/**
 * Builds the PDF to hand out. With `apply`, the redacted areas are removed from
 * the page content (text, the pixels of images, line art) and everything else
 * that can carry their content is taken out of the file; the result is written
 * from scratch, so nothing an earlier version or an editor left behind survives.
 */
export function exportDocument(source: Uint8Array, annotations: ExportAnnotation[], options: ExportOptions): ExportResult {
  const doc = mupdf.Document.openDocument(source, 'application/pdf') as PDFDocument
  const removed: Removed = {
    attachments: 0, scripts: 0, bookmarks: 0, links: 0, thumbnails: 0, comments: 0, formFields: 0,
    documentProperties: [], xmpMetadata: false, structureTree: false, privateData: 0,
  }
  const areas: RedactedArea[] = []
  const pageCount = doc.countPages()

  try {
    if (options.apply) {
      // Comments go. Form fields are drawn into the page first, so that what is
      // filled in becomes ordinary page content that a redaction can remove.
      for (let i = 0; i < pageCount; i++) {
        const page = doc.loadPage(i)
        removed.comments += deleteAllAnnotations(page)
        removed.formFields += page.getWidgets().length
        page.update()
      }
      if (removed.formFields) doc.bake(false, true)
    }

    // Note what stands in each area before it is removed; the check afterwards
    // looks for exactly this text.
    const charsByPage = new Map<number, Char[]>()
    for (const annotation of annotations) {
      const pageIndex = annotation.position.pageNumber
      if (!charsByPage.has(pageIndex)) charsByPage.set(pageIndex, pageChars(doc.loadPage(pageIndex)))
      areas.push({
        pageIndex,
        quads: annotation.position.quads,
        text: textInside(charsByPage.get(pageIndex)!, annotation.position.quads.map(quadBox)),
      })
    }

    for (const annotation of annotations) {
      const page = doc.loadPage(annotation.position.pageNumber)
      const redaction = page.createAnnotation('Redact')
      redaction.setContents(annotation.content)
      redaction.setQuadPoints(annotation.position.quads as never)
      if (options.apply) {
        redaction.applyRedaction(
          1,
          mupdf.PDFPage.REDACT_IMAGE_PIXELS,
          mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_TOUCHED,
          mupdf.PDFPage.REDACT_TEXT_REMOVE,
        )
        const label = page.createAnnotation('FreeText')
        label.setContents(annotation.content)
        label.setRect(annotation.position.rect as never)
        label.setDefaultAppearance('Helvetica', 8, [1, 1, 1])
      }
    }
    for (let i = 0; i < pageCount; i++) doc.loadPage(i).update()

    const root = doc.getTrailer().get('Root')
    const info = doc.getTrailer().get('Info')

    if (options.apply) {
      doc.bake()

      // Links can name what was redacted (mailto:, a URL with a name in it).
      // Those that sit on a redacted area go, and so does any link whose target
      // contains a word of the redacted text - rather one link too many.
      const terms = [...new Set(areas.flatMap(a => words(a.text)))]
      for (let i = 0; i < pageCount; i++) {
        const page = doc.loadPage(i)
        const boxes = areas.filter(a => a.pageIndex === i).flatMap(a => a.quads.map(quadBox))
        for (const link of page.getLinks()) {
          const target = link.getURI() ?? ''
          let uri = squash(target)
          try { uri = squash(decodeURIComponent(target)) } catch { /* not percent-encoded */ }
          const bounds = link.getBounds() as unknown as number[]
          const box = { x0: bounds[0], y0: bounds[1], x1: bounds[2], y1: bounds[3] }
          if (boxes.some(b => intersects(b, box)) || terms.some(t => uri.includes(t))) {
            page.deleteLink(link)
            removed.links++
          }
        }
        // A thumbnail is a picture of the page as it was before the redaction;
        // private application data can hold the original content too.
        const pageObject = page.getObject()
        if (!pageObject.get('Thumb').isNull()) { pageObject.delete('Thumb'); removed.thumbnails++ }
        if (!pageObject.get('PieceInfo').isNull()) { pageObject.delete('PieceInfo'); removed.privateData++ }
        if (!pageObject.get('Metadata').isNull()) { pageObject.delete('Metadata'); removed.xmpMetadata = true }
      }

      for (const name of Object.keys(doc.getEmbeddedFiles())) {
        doc.deleteEmbeddedFile(name)
        removed.attachments++
      }

      if (isJavaScriptAction(root.get('OpenAction'))) { root.delete('OpenAction'); removed.scripts++ }
      if (!root.get('AA').isNull()) { root.delete('AA'); removed.scripts++ }
      const names = root.get('Names')
      if (!names.isNull() && names.isDictionary() && !names.get('JavaScript').isNull()) {
        names.delete('JavaScript')
        removed.scripts++
      }

      // Bookmarks, the tagging structure and its alternative texts repeat the
      // page content in their own words. They are removed as a whole rather
      // than searched for traces.
      removed.bookmarks = countOutline(doc.loadOutline())
      if (!root.get('Outlines').isNull()) root.delete('Outlines')
      if (!root.get('StructTreeRoot').isNull()) {
        root.delete('StructTreeRoot')
        root.delete('MarkInfo')
        removed.structureTree = true
      }
      if (!root.get('PieceInfo').isNull()) { root.delete('PieceInfo'); removed.privateData++ }
      if (!root.get('Metadata').isNull()) { root.delete('Metadata'); removed.xmpMetadata = true }
    }

    if (info && !info.isNull() && info.isDictionary()) {
      for (const key of options.fieldsToRemove) {
        if (!info.get(key).isNull()) { info.delete(key); removed.documentProperties.push(key) }
      }
      info.put('Producer', doc.newString(options.producerLabel))
    }
    if (!options.apply && options.fieldsToRemove.length && !root.get('Metadata').isNull()) {
      root.delete('Metadata')
      removed.xmpMetadata = true
    }

    // Written from scratch, never appended: objects nothing refers to any more -
    // replaced page content, deleted comments, earlier versions - are left out.
    const pdf = doc.saveToBuffer('garbage=compact,compress,regenerate-id').asUint8Array().slice()
    return { pdf, areas, removed }
  } finally {
    doc.destroy()
  }
}

// Every text string in the file's objects, decoded, plus the content of the
// streams that hold text of their own (metadata, attachments, scripts).
function documentData(doc: PDFDocument): string {
  const parts: string[] = []
  const seen = new Set<number>()

  const visit = (obj: PDFObject, depth: number) => {
    if (!obj || obj.isNull() || depth > 40) return
    if (obj.isIndirect()) {
      const number = obj.asIndirect()
      if (seen.has(number)) return
      seen.add(number)
    }
    if (obj.isString()) { parts.push(obj.asString()); return }
    if (obj.isStream()) {
      const type = obj.get('Type')
      const subtype = obj.get('Subtype')
      const kind = `${type.isName() ? type.asName() : ''}/${subtype.isName() ? subtype.asName() : ''}`
      // Page content, images and fonts are checked through the page text, not
      // here: their bytes are glyph codes and pixels, not readable text.
      if (/Metadata|XML|EmbeddedFile/.test(kind)) {
        try { parts.push(new TextDecoder('latin1').decode(obj.readStream().asUint8Array())) } catch { /* unreadable stream */ }
      }
    }
    if (obj.isDictionary()) obj.forEach(value => visit(value, depth + 1))
    else if (obj.isArray()) obj.forEach(value => visit(value, depth + 1))
  }

  const count = doc.countObjects()
  for (let i = 1; i < count; i++) {
    try { visit(doc.newIndirect(i), 0) } catch { /* free or broken object */ }
  }
  return parts.join('\n').toLowerCase()
}

/**
 * Opens an exported PDF again and checks that the redaction held: no text left
 * under a redacted area, no redacted text anywhere outside the page content,
 * and none of the carriers `exportDocument` removes still present.
 */
export function verifyExport(pdf: Uint8Array, areas: RedactedArea[], removed: Removed, fieldsToRemove: string[] = []): ExportReport {
  const doc = mupdf.Document.openDocument(pdf, 'application/pdf') as PDFDocument
  const problems: Problem[] = []
  try {
    const pageCount = doc.countPages()
    const charsByPage: Char[][] = []
    const pageText: string[] = []
    for (let i = 0; i < pageCount; i++) {
      const page = doc.loadPage(i)
      const chars = pageChars(page)
      charsByPage.push(chars)
      pageText.push(normalize(chars.map(ch => (ch.c === '\n' ? ' ' : ch.c)).join('')))
      if (page.getWidgets().length) problems.push({ kind: 'form-field', pageIndex: i })
      if (page.getAnnotations().length) problems.push({ kind: 'comment', pageIndex: i })
      if (!page.getObject().get('Thumb').isNull()) problems.push({ kind: 'thumbnail', pageIndex: i })
    }

    for (const area of areas) {
      const left = textInside(charsByPage[area.pageIndex] ?? [], area.quads.map(quadBox))
      if (left) problems.push({ kind: 'text-under-redaction', pageIndex: area.pageIndex, detail: left })
    }

    const data = documentData(doc)
    const squashedData = squash(data)
    const terms = [...new Set(areas.map(a => normalize(a.text)).filter(t => t.length >= MIN_TERM_LENGTH))]
    const remainingMentions: RemainingMention[] = []
    for (const term of terms) {
      const pages = pageText.flatMap((text, i) => (text.includes(term) ? [i] : []))
      if (pages.length) remainingMentions.push({ text: term, pageIndexes: pages })
      if (data.includes(term) || squashedData.includes(squash(term))) problems.push({ kind: 'term-in-document-data', detail: term })
    }

    const root = doc.getTrailer().get('Root')
    if (Object.keys(doc.getEmbeddedFiles()).length) problems.push({ kind: 'attachment' })
    if (isJavaScriptAction(root.get('OpenAction')) || !root.get('AA').isNull()) problems.push({ kind: 'script' })
    const names = root.get('Names')
    if (!names.isNull() && names.isDictionary() && !names.get('JavaScript').isNull()) problems.push({ kind: 'script' })
    if (!root.get('Outlines').isNull()) problems.push({ kind: 'bookmark' })
    if (!root.get('Metadata').isNull()) problems.push({ kind: 'xmp-metadata' })
    if (doc.countVersions() > 1) problems.push({ kind: 'earlier-version' })
    const info = doc.getTrailer().get('Info')
    if (info && !info.isNull() && info.isDictionary()) {
      for (const key of fieldsToRemove) {
        // The export writes its own Producer, so that field is there by design.
        if (key !== 'Producer' && !info.get(key).isNull()) problems.push({ kind: 'document-property', detail: key })
      }
    }

    return { ok: problems.length === 0, redactedAreas: areas.length, problems, remainingMentions, removed }
  } finally {
    doc.destroy()
  }
}

/**
 * Finds text that is in the page but leaves no mark on it: white on white,
 * drawn in the invisible render mode, or too small to be seen. Such text is
 * copied along with everything else, so it has to be shown to whoever redacts.
 *
 * It works from the rendered page: where a word's place shows no ink at all,
 * the word is invisible. The text layer of a scanned page lies on top of the
 * scan's own ink and is therefore, correctly, not reported.
 */
export function findInvisibleText(doc: PDFDocument, pageIndex: number): InvisibleText[] {
  const SCALE = 2
  const MIN_CONTRAST = 24 // grey levels between the lightest and the darkest pixel
  const MIN_VISIBLE_SIZE = 2 // points

  const page = doc.loadPage(pageIndex)
  const pixmap = page.toPixmap([SCALE, 0, 0, SCALE, 0, 0], mupdf.ColorSpace.DeviceGray, false)
  try {
    const pixels = pixmap.getPixels()
    const stride = pixmap.getStride()
    const [originX, originY] = pixmap.getBounds() as unknown as number[]
    const width = pixmap.getWidth()
    const height = pixmap.getHeight()

    const hasInk = (box: Box) => {
      const x0 = Math.max(0, Math.floor(box.x0 * SCALE - originX))
      const y0 = Math.max(0, Math.floor(box.y0 * SCALE - originY))
      const x1 = Math.min(width, Math.ceil(box.x1 * SCALE - originX))
      const y1 = Math.min(height, Math.ceil(box.y1 * SCALE - originY))
      let lightest = 0
      let darkest = 255
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const value = pixels[y * stride + x]
          if (value > lightest) lightest = value
          if (value < darkest) darkest = value
          if (lightest - darkest >= MIN_CONTRAST) return true
        }
      }
      return false
    }

    // Words, and for each whether it can be seen; neighbours on a line that
    // cannot are joined into one stretch.
    const found: InvisibleText[] = []
    let word: { text: string; box: Box; size: number } | null = null
    let run: { text: string; boxes: Box[] } | null = null

    const closeRun = () => {
      if (run) found.push({ text: run.text, quads: run.boxes.map(b => [b.x0, b.y0, b.x1, b.y0, b.x0, b.y1, b.x1, b.y1]) })
      run = null
    }
    const closeWord = () => {
      if (!word) return
      const invisible = word.size < MIN_VISIBLE_SIZE || !hasInk(word.box)
      if (invisible) {
        if (run) { run.text += ` ${word.text}`; run.boxes.push(word.box) }
        else run = { text: word.text, boxes: [word.box] }
      } else {
        closeRun()
      }
      word = null
    }

    for (const { c, box, size } of pageChars(page)) {
      if (c === '\n') { closeWord(); closeRun(); continue }
      if (/\s/.test(c)) { closeWord(); continue }
      if (!word) word = { text: c, box: { ...box }, size }
      else {
        word.text += c
        word.box = { x0: Math.min(word.box.x0, box.x0), y0: Math.min(word.box.y0, box.y0), x1: Math.max(word.box.x1, box.x1), y1: Math.max(word.box.y1, box.y1) }
      }
    }
    closeWord()
    closeRun()
    return found
  } finally {
    pixmap.destroy()
  }
}
