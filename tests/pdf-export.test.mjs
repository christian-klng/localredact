// The redacted PDF must not contain what was redacted. These tests build a PDF
// that carries the same names in every place a PDF offers, export it, and look
// through the whole result - decompressed, object by object - for what is left.
//
//   node --test tests/
import assert from 'node:assert/strict'
import test from 'node:test'
import * as mupdf from 'mupdf'
import { exportDocument, findInvisibleText, takeAnnotations, verifyExport } from '../src/lib/pdf-export.ts'

const PAGE = [0, 0, 595, 842]

function buildDocument() {
  const doc = new mupdf.PDFDocument()
  const font = doc.addSimpleFont(new mupdf.Font('Helvetica'))
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 40, 40], false)
  pixmap.clear(200)
  const image = doc.addImage(new mupdf.Image(pixmap))
  const resources = doc.addObject({ Font: { F1: font }, XObject: { Im1: image } })
  const content = [
    'BT /F1 12 Tf 72 760 Td (Antragstellerin: Lena Hoffmann, Birkenweg 14) Tj ET',
    'BT /F1 12 Tf 72 730 Td (Sachbearbeitung: Petra Lindner bleibt sichtbar) Tj ET',
    'BT /F1 12 Tf 3 Tr 72 700 Td (UNSICHTBAR Thomas Berger) Tj 0 Tr ET',
    'BT /F1 12 Tf 1 1 1 rg 72 670 Td (WEISS Maria Yilmaz) Tj 0 0 0 rg ET',
    'BT /F1 1 Tf 72 640 Td (WINZIG Kontonummer 12345) Tj ET',
    'q 120 0 0 120 72 480 cm /Im1 Do Q',
    'BT /F1 12 Tf 72 420 Td (Zweite Nennung: Lena Hoffmann bleibt hier stehen) Tj ET',
  ].join('\n')
  doc.insertPage(-1, doc.addPage(PAGE, 0, resources, content))

  // An old content stream nothing refers to any more, as an editor leaves it.
  doc.addStream('BT /F1 12 Tf 72 760 Td (VERWAIST Lena Hoffmann) Tj ET', {})

  doc.setMetaData('info:Author', 'AUTOR-GEHEIM')
  doc.setMetaData('info:Title', 'TITEL Lena Hoffmann')
  const root = doc.getTrailer().get('Root')
  root.put('Metadata', doc.addStream('<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:creator>XMP Lena Hoffmann</dc:creator></x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' }))
  doc.insertEmbeddedFile('anhang.txt', doc.addEmbeddedFile('anhang.txt', 'text/plain', 'ANHANG Lena Hoffmann', new Date(), new Date()))
  root.put('OpenAction', doc.addObject({ S: 'JavaScript', JS: doc.newString("app.alert('SKRIPT Lena Hoffmann')") }))
  doc.outlineIterator().insert({ title: 'LESEZEICHEN Lena Hoffmann', uri: '#page=1', open: false })

  const page = doc.loadPage(0)
  page.createLink([72, 600, 300, 620], 'mailto:lena.hoffmann@example.de')
  page.createLink([72, 380, 300, 400], 'https://example.org/unbeteiligt')
  // Two comments: removing them one after the other is where a careless loop
  // leaves the second one behind.
  for (const [text, y] of [['KOMMENTAR Lena Hoffmann', 700], ['ZWEITER-KOMMENTAR Lena Hoffmann', 660]]) {
    const note = page.createAnnotation('Text')
    note.setContents(text)
    note.setRect([400, y, 420, y + 20])
  }
  page.update()
  page.getObject().put('Thumb', image)
  return doc.saveToBuffer('').asUint8Array().slice()
}

// Redacts the first "Lena Hoffmann" and the left half of the image.
function annotationsFor(source) {
  const doc = mupdf.Document.openDocument(source, 'application/pdf')
  const quads = doc.loadPage(0).search('Lena Hoffmann')[0]
  const box = q => [Math.min(q[0], q[4]), Math.min(q[1], q[5]), Math.max(q[2], q[6]), Math.max(q[3], q[7])]
  // The page content places the image at y 480..600 from the bottom; MuPDF counts from the top.
  const imageHalf = [72, 842 - 600, 132, 842 - 480]
  const asQuad = r => [r[0], r[1], r[2], r[1], r[0], r[3], r[2], r[3]]
  return [
    { content: '', position: { pageNumber: 0, rect: box(quads[0]), quads } },
    { content: '', position: { pageNumber: 0, rect: imageHalf, quads: [asQuad(imageHalf)] } },
  ]
}

// The whole file with every stream decompressed, as one searchable string.
function everything(pdf) {
  const doc = mupdf.Document.openDocument(pdf, 'application/pdf')
  return Buffer.from(doc.saveToBuffer('decompress').asUint8Array()).toString('latin1')
}
const pageText = pdf => mupdf.Document.openDocument(pdf, 'application/pdf').loadPage(0).toStructuredText().asText()

const OPTIONS = { apply: true, fieldsToRemove: ['Author', 'Title'], producerLabel: 'Geschwärzt' }

test('the test document really carries the name in all those places', () => {
  const raw = everything(buildDocument())
  for (const marker of ['VERWAIST', 'AUTOR-GEHEIM', 'TITEL', 'XMP', 'ANHANG', 'SKRIPT', 'LESEZEICHEN', 'lena.hoffmann@example.de', 'KOMMENTAR']) {
    assert.ok(raw.includes(marker), `${marker} is missing from the test document`)
  }
})

test('nothing of the redacted text is left anywhere in the exported file', () => {
  const source = buildDocument()
  const { pdf } = exportDocument(source, annotationsFor(source), OPTIONS)
  const raw = everything(pdf)
  for (const marker of ['VERWAIST', 'AUTOR-GEHEIM', 'TITEL', 'XMP', 'ANHANG', 'SKRIPT', 'LESEZEICHEN', 'lena.hoffmann@example.de', 'KOMMENTAR', 'ZWEITER-KOMMENTAR']) {
    assert.ok(!raw.includes(marker), `${marker} survived the export`)
  }
  assert.ok(!raw.includes('/Thumb'), 'a page thumbnail survived')
})

test('the redacted occurrence is gone from the page, the rest of the page stays', () => {
  const source = buildDocument()
  const { pdf, areas } = exportDocument(source, annotationsFor(source), OPTIONS)
  const text = pageText(pdf)
  assert.equal(areas[0].text, 'Lena Hoffmann')
  assert.ok(!text.includes('Antragstellerin: Lena Hoffmann'))
  assert.ok(text.includes('Birkenweg 14'))
  assert.ok(text.includes('Petra Lindner'))
  assert.ok(text.includes('Zweite Nennung: Lena Hoffmann'), 'an occurrence that was not redacted must stay')
})

test('the pixels of an image under a redaction are replaced', () => {
  const source = buildDocument()
  const { pdf } = exportDocument(source, annotationsFor(source), OPTIONS)
  const pixmap = mupdf.Document.openDocument(pdf, 'application/pdf').loadPage(0).toPixmap([1, 0, 0, 1, 0, 0], mupdf.ColorSpace.DeviceGray, false)
  const at = (x, y) => pixmap.getPixels()[y * pixmap.getStride() + x]
  assert.ok(at(100, 300) < 40, 'the redacted half of the image should be black')
  assert.ok(at(170, 300) > 150, 'the other half of the image should be untouched')
})

test('a link that names the redacted person goes, an unrelated link stays', () => {
  const source = buildDocument()
  const { pdf, removed } = exportDocument(source, annotationsFor(source), OPTIONS)
  const links = mupdf.Document.openDocument(pdf, 'application/pdf').loadPage(0).getLinks().map(l => l.getURI())
  assert.deepEqual(links, ['https://example.org/unbeteiligt'])
  assert.equal(removed.links, 1)
})

test('the report says what was removed and passes for a clean export', () => {
  const source = buildDocument()
  const { pdf, areas, removed } = exportDocument(source, annotationsFor(source), OPTIONS)
  const report = verifyExport(pdf, areas, removed, OPTIONS.fieldsToRemove)
  assert.deepEqual(report.problems, [])
  assert.equal(report.ok, true)
  assert.equal(removed.attachments, 1)
  assert.equal(removed.bookmarks, 1)
  assert.equal(removed.scripts, 1)
  assert.equal(removed.comments, 2)
  assert.equal(removed.thumbnails, 1)
  assert.equal(removed.xmpMetadata, true)
  assert.deepEqual(removed.documentProperties.sort(), ['Author', 'Title'])
  // The second, unredacted mention is reported, not treated as a failure.
  assert.deepEqual(report.remainingMentions, [{ text: 'lena hoffmann', pageIndexes: [0] }])
})

test('removing the Producer field replaces it with the export\'s own and passes the check', () => {
  const source = buildDocument()
  const fieldsToRemove = ['Author', 'Title', 'Producer']
  const { pdf, areas, removed } = exportDocument(source, annotationsFor(source), { ...OPTIONS, fieldsToRemove })
  assert.equal(verifyExport(pdf, areas, removed, fieldsToRemove).ok, true)
  assert.equal(mupdf.Document.openDocument(pdf, 'application/pdf').getMetaData('info:Producer'), 'Geschwärzt')
})

test('the check fails for a file that was only painted over', () => {
  const source = buildDocument()
  const annotations = annotationsFor(source)
  const { areas, removed } = exportDocument(source, annotations, OPTIONS)
  // What a naive tool produces: a black box drawn on top, everything else kept.
  const doc = mupdf.Document.openDocument(source, 'application/pdf')
  const box = doc.loadPage(0).createAnnotation('Square')
  box.setRect(annotations[0].position.rect)
  box.setInteriorColor([0, 0, 0])
  doc.loadPage(0).update()
  doc.bake()
  const painted = doc.saveToBuffer('').asUint8Array().slice()

  const report = verifyExport(painted, areas, removed, OPTIONS.fieldsToRemove)
  assert.equal(report.ok, false)
  const kinds = new Set(report.problems.map(p => p.kind))
  for (const kind of ['text-under-redaction', 'term-in-document-data', 'attachment', 'script', 'bookmark', 'xmp-metadata', 'thumbnail', 'document-property']) {
    assert.ok(kinds.has(kind), `the check should have reported: ${kind}`)
  }
})

test('a document with a note comment opens, and its markings become redaction areas', () => {
  const doc = mupdf.Document.openDocument(buildDocument(), 'application/pdf')
  const page = doc.loadPage(0)
  const highlight = page.createAnnotation('Highlight')
  highlight.setQuadPoints(page.search('Petra Lindner')[0])
  page.update()

  // The note has no area and must not make this fail; the highlight has one.
  const markings = takeAnnotations(doc)
  assert.equal(markings.length, 1)
  assert.equal(markings[0].pageIndex, 0)
  assert.equal(doc.loadPage(0).getAnnotations().length, 0)
})

test('text that cannot be seen on the page is found', () => {
  const doc = mupdf.Document.openDocument(buildDocument(), 'application/pdf')
  const found = findInvisibleText(doc, 0).map(f => f.text)
  assert.deepEqual(found, ['UNSICHTBAR Thomas Berger', 'WEISS Maria Yilmaz', 'WINZIG Kontonummer 12345'])
})

test('a preview export changes nothing but the marked areas', () => {
  const source = buildDocument()
  const { pdf, removed } = exportDocument(source, annotationsFor(source), { apply: false, fieldsToRemove: [], producerLabel: 'Vorschau' })
  assert.ok(pageText(pdf).includes('Antragstellerin: Lena Hoffmann'))
  assert.equal(removed.attachments, 0)
  assert.equal(removed.bookmarks, 0)
})
