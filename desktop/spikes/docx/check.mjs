// Spike: which parts of a DOCX end up in the converted PDF?
// Reads out/<tool>/<name>.pdf relative to the current directory and reports,
// per tool, which problem-case markers from make_docx.py are in the text layer.
//
//   python3 make_docx.py in/problemfaelle.docx
//   soffice --headless --convert-to pdf --outdir out/libreoffice in/problemfaelle.docx
//   electron convert.js in/problemfaelle.docx out      (needs mammoth, docx-preview, jszip)
//   node check.mjs problemfaelle libreoffice mammoth docx-preview
import * as mupdf from '../../../node_modules/mupdf/dist/mupdf.js'
import { readFileSync, writeFileSync } from 'node:fs'
const markers = { 'ALPHA-1001': 'Fliesstext', 'EINGEFUEGT-2002': 'Nachverfolgung: eingefuegt', 'GELOESCHT-3003': 'Nachverfolgung: geloescht', 'VERSTECKT-4004': 'ausgeblendeter Text', 'KOMMENTAR-5005': 'Kommentar', 'KOPFZEILE-6006': 'Kopfzeile', 'FUSSZEILE-7007': 'Fusszeile', 'FUSSNOTE-8008': 'Fussnote', 'WEISS-4444': 'weisser Text', 'TABELLE-9009': 'Tabelle', 'TEXTFELD-1111': 'Textfeld', 'SEITE2-3333': 'nach Seitenumbruch', 'AUTOR-2222': 'Autor (Metadaten)', 'Petra Lindner': 'Name der Bearbeiterin' }
const rows = {}
for (const tool of process.argv.slice(3)) {
  const doc = mupdf.Document.openDocument(readFileSync(`out/${tool}/${process.argv[2]}.pdf`), 'application/pdf')
  let text = ''
  const pages = doc.countPages()
  for (let i = 0; i < pages; i++) text += doc.loadPage(i).toStructuredText().asText() + '\n'
  const meta = ['info:Title', 'info:Author', 'info:Creator', 'info:Producer'].map(k => `${k.slice(5)}=${doc.getMetaData(k) ?? ''}`).join(' | ')
  const page = doc.loadPage(0)
  writeFileSync(`out/${tool}/${process.argv[2]}-p1.png`, page.toPixmap(mupdf.Matrix.scale(1, 1), mupdf.ColorSpace.DeviceRGB, false).asPNG())
  console.log(`${tool}: pages=${pages} | ${meta}`)
  for (const m of Object.keys(markers)) (rows[m] ??= []).push(text.includes(m) || meta.includes(m) ? 'JA' : '-')
}
console.log('\n' + 'Marker'.padEnd(46) + process.argv.slice(3).map(t => t.padEnd(14)).join(''))
for (const [m, r] of Object.entries(rows)) console.log(`${(m + ' (' + markers[m] + ')').padEnd(46)}${r.map(x => x.padEnd(14)).join('')}`)
