/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import * as mupdf from 'mupdf'
import { PDFDocument } from 'mupdf'
import type { Quad, Rect } from 'mupdf'
import { exportDocument, findInvisibleText, takeAnnotations, verifyExport } from '@/lib/pdf-export'
import type { ExportAnnotation, ExportReport, InvisibleText } from '@/lib/pdf-export'

export const MUPDF_LOADED = 'MUPDF_LOADED'

// A short, plain label for the PDF's Producer field — kept in the user's own
// language rather than a fixed English/branded string, since this metadata is
// visible to anyone inspecting the exported file's properties.
const REDACTED_LABEL: Record<string, string> = {
  en: 'Redacted',
  de: 'Geschwärzt',
  fr: 'Caviardé',
  es: 'Redactado',
  ru: 'Отредактировано',
  ar: 'تم الحجب',
  zh: '已脱敏',
}

// Define an interface for the word data we'll return
export interface WordData {
  text: string
  bbox: {
    x0: number
    y0: number
    x1: number
    y1: number
  }
}

export class MupdfWorker {
  private pdfdocument?: PDFDocument

  constructor() {
    this.initializeMupdf()
  }

  private initializeMupdf() {
    try {
      postMessage(MUPDF_LOADED)
    } catch (error) {
      console.error('Failed to initialize MuPDF:', error)
    }
  }

  loadDocument(document: ArrayBuffer): boolean {
    this.pdfdocument = mupdf.Document.openDocument(
      document,
      'application/pdf'
    ) as PDFDocument
    return true
  }

  loadDocumentAndAnnotations(document: ArrayBuffer): any[] {
    this.loadDocument(document)
    if (!this.pdfdocument) throw new Error('Document not loaded')
    const annotations = takeAnnotations(this.pdfdocument)
    // What is filled into form fields is not part of the page text. Drawing the
    // fields into the page makes it visible to the analysis and removable by a
    // redaction, like everything else on the page.
    try {
      let fields = 0
      for (let i = 0; i < this.getPageCount(); i++) fields += this.pdfdocument.loadPage(i).getWidgets().length
      if (fields) this.pdfdocument.bake(false, true)
    } catch (err) {
      console.error('Form fields could not be drawn into the page:', err)
    }
    return annotations
  }

  renderPageAsImage(pageIndex: number = 0, scale: number = 1): Uint8Array {
    if (!this.pdfdocument) throw new Error('Document not loaded')
    const page = this.pdfdocument.loadPage(pageIndex)
    const pixmap = page.toPixmap(
      [scale, 0, 0, scale, 0, 0],
      mupdf.ColorSpace.DeviceRGB
    )
    const png = pixmap.asPNG()
    pixmap.destroy()
    return png
  }

  getPageBounds(pageIndex: number = 0): Rect {
    if (!this.pdfdocument) throw new Error('Document not loaded')
    return this.pdfdocument.loadPage(pageIndex).getBounds()
  }

  getPageContent(pageIndex: number = 0): string {
    if (!this.pdfdocument) throw new Error('Document not loaded')
    return this.pdfdocument
      .loadPage(pageIndex)
      .toStructuredText()
      .asJSON()
  }

  searchPage(pageIndex: number = 0, text: string): Quad[][] {
    if (!this.pdfdocument) throw new Error('Document not loaded')
    const page = this.pdfdocument.loadPage(pageIndex)
    const words = page.search(text)
    return words
  }

  getPageCount(): number {
    if (!this.pdfdocument) throw new Error('Document not loaded')
    return this.pdfdocument.countPages()
  }

  getPageWords(pageIndex: number = 0): WordData[] {
    if (!this.pdfdocument) throw new Error('Document not loaded')

    const page = this.pdfdocument.loadPage(pageIndex)
    const structuredText = page.toStructuredText('words')

    const words: WordData[] = []
    let currentWord = ''
    let currentQuad:
      | [number, number, number, number, number, number, number, number]
      | null = null

    structuredText.walk({
      onChar(c, _origin, _font, _size, quad) {
        if (c === ' ' && currentWord) {
          if (currentQuad) {
            const [_x0, _y0, _x1, _y1, _x2, _y2, _x3, _y3] = currentQuad
            const x0 = Math.min(_x0, _x1, _x2, _x3)
            const y0 = Math.min(_y0, _y1, _y2, _y3)
            const x1 = Math.max(_x0, _x1, _x2, _x3)
            const y1 = Math.max(_y0, _y1, _y2, _y3)

            words.push({
              text: currentWord,
              bbox: { x0, y0, x1, y1 }
            })
          }
          currentWord = ''
          currentQuad = null
        } else if (c !== ' ') {
          if (!currentQuad) {
            currentQuad = quad
          } else {
            currentQuad[4] = quad[4]
            currentQuad[5] = quad[5]
            currentQuad[2] = quad[2]
            currentQuad[3] = quad[3]
            currentQuad[6] = quad[6]
            currentQuad[7] = quad[7]
          }
          currentWord += c
        }
      },

      endLine() {
        if (currentWord && currentQuad) {
          const [_x0, _y0, _x1, _y1, _x2, _y2, _x3, _y3] = currentQuad
          const x0 = Math.min(_x0, _x1, _x2, _x3)
          const y0 = Math.min(_y0, _y1, _y2, _y3)
          const x1 = Math.max(_x0, _x1, _x2, _x3)
          const y1 = Math.max(_y0, _y1, _y2, _y3)

          words.push({
            text: currentWord,
            bbox: { x0, y0, x1, y1 }
          })

          currentWord = ''
          currentQuad = null
        }
      },

      endTextBlock() {
        // Text block ends
      }
    })

    return words
  }

  getMetadata(): Record<string, string> {
    if (!this.pdfdocument) throw new Error('Document not loaded')
    const result: Record<string, string> = {}
    const info = this.pdfdocument.getTrailer().get('Info')
    if (info && !info.isNull() && info.isDictionary()) {
      info.forEach((val: any, key: string | number) => {
        if (typeof key === 'string' && val.isString()) result[key] = val.asString()
      })
    }
    return result
  }

  // The export itself and the check of its result live in pdf-export.ts. The
  // check only applies to the final export: a preview keeps everything.
  getRedactedDocument(annotations: ExportAnnotation[], applyRedactions: boolean = true, fieldsToRemove: string[] = [], locale: string = 'en'): { blob: Blob; report: ExportReport | null } {
    if (!this.pdfdocument) throw new Error('Document not loaded')

    const source = this.pdfdocument.saveToBuffer().asUint8Array().slice()
    const { pdf, areas, removed } = exportDocument(source, annotations, {
      apply: applyRedactions,
      fieldsToRemove,
      producerLabel: REDACTED_LABEL[locale] ?? REDACTED_LABEL.en,
    })
    const report = applyRedactions ? verifyExport(pdf, areas, removed, fieldsToRemove) : null
    return { blob: new Blob([pdf as unknown as BlobPart], { type: 'application/pdf' }), report }
  }

  getInvisibleText(pageIndex: number = 0): InvisibleText[] {
    if (!this.pdfdocument) throw new Error('Document not loaded')
    return findInvisibleText(this.pdfdocument, pageIndex)
  }
}

Comlink.expose(new MupdfWorker())

