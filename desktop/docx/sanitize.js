// Cleans a DOCX before it is converted to PDF, so that nothing reaches the PDF
// that a reader of the document in Word would not see as part of its final text:
//
// - tracked changes are accepted (deleted text is removed, inserted text kept),
// - comments are removed,
// - hidden text is removed,
// - document properties (author, company, ...) are emptied.
//
// Every converter gets the same cleaned file, so the built-in renderer and
// LibreOffice behave alike.
const JSZip = require('jszip')
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom')

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

// Parts that carry document text.
const TEXT_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/
// Parts that only exist to describe comments or their authors.
const COMMENT_PARTS = /^word\/(comments\w*|people)\.xml$/

const EMPTY_PROPERTIES = {
  'docProps/core.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>',
  'docProps/app.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>',
  'docProps/custom.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"/>',
}

const all = (node, name) => Array.from(node.getElementsByTagNameNS(W, name))
const child = (node, name) => Array.from(node.childNodes).find(n => n.namespaceURI === W && n.localName === name)
const remove = node => node.parentNode?.removeChild(node)

function unwrap(node) {
  const parent = node.parentNode
  if (!parent) return
  while (node.firstChild) parent.insertBefore(node.firstChild, node)
  parent.removeChild(node)
}

// An on/off property such as <w:vanish/> is on unless w:val says otherwise.
function isOn(node) {
  if (!node) return false
  const val = node.getAttributeNS(W, 'val') || node.getAttribute('w:val')
  return !['0', 'false', 'off'].includes(val)
}

function ancestor(node, name) {
  for (let n = node.parentNode; n; n = n.parentNode) {
    if (n.namespaceURI === W && n.localName === name) return n
  }
  return null
}

// Style ids whose run properties hide text.
function hiddenStyles(stylesXml) {
  const ids = new Set()
  if (!stylesXml) return ids
  const doc = new DOMParser().parseFromString(stylesXml, 'text/xml')
  for (const style of all(doc, 'style')) {
    const rPr = child(style, 'rPr')
    if (rPr && isOn(child(rPr, 'vanish'))) ids.add(style.getAttributeNS(W, 'styleId') || style.getAttribute('w:styleId'))
  }
  return ids
}

function styleOf(props, name) {
  const style = props && child(props, name)
  return style ? style.getAttributeNS(W, 'val') || style.getAttribute('w:val') : null
}

function isHiddenRun(run, hidden) {
  const rPr = child(run, 'rPr')
  const vanish = rPr && child(rPr, 'vanish')
  if (vanish) return isOn(vanish)
  if (hidden.has(styleOf(rPr, 'rStyle'))) return true
  const paragraph = ancestor(run, 'p')
  return !!paragraph && hidden.has(styleOf(child(paragraph, 'pPr'), 'pStyle'))
}

function cleanTextPart(xml, hidden, removed) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')

  // Deleted and moved-away content. A <w:del> marker inside row properties
  // means the whole table row was deleted; inside run properties it only marks
  // a deleted paragraph mark.
  for (const name of ['del', 'moveFrom']) {
    for (const node of all(doc, name)) {
      if (!node.parentNode) continue
      const parent = node.parentNode.localName
      if (parent === 'trPr') { remove(ancestor(node, 'tr')); removed.deletions++; continue }
      if (parent === 'rPr') { remove(node); continue }
      if (node.textContent.trim()) removed.deletions++
      remove(node)
    }
  }
  // Inserted and moved-in content stays; only the tracking wrapper goes.
  for (const name of ['ins', 'moveTo']) {
    for (const node of all(doc, name)) {
      if (!node.parentNode) continue
      if (['rPr', 'trPr'].includes(node.parentNode.localName)) remove(node)
      else { removed.insertionsAccepted++; unwrap(node) }
    }
  }
  // Records of earlier formatting and the range markers of moves.
  for (const node of Array.from(doc.getElementsByTagNameNS(W, '*'))) {
    if (/Change$|^move(From|To)Range(Start|End)$/.test(node.localName)) remove(node)
  }

  for (const name of ['commentRangeStart', 'commentRangeEnd', 'commentReference']) {
    for (const node of all(doc, name)) {
      if (name === 'commentReference') removed.comments++
      remove(node)
    }
  }

  for (const run of all(doc, 'r')) {
    if (run.parentNode && isHiddenRun(run, hidden)) {
      if (run.textContent.trim()) removed.hiddenRuns++
      remove(run)
    }
  }

  return new XMLSerializer().serializeToString(doc)
}

function emptyRoot(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const root = doc.documentElement
  while (root.firstChild) root.removeChild(root.firstChild)
  return new XMLSerializer().serializeToString(doc)
}

/**
 * @param {Buffer} input the original DOCX
 * @returns {Promise<{ buffer: Buffer, removed: { deletions: number, insertionsAccepted: number, comments: number, hiddenRuns: number, properties: boolean } }>}
 */
async function sanitizeDocx(input) {
  const zip = await JSZip.loadAsync(input)
  const removed = { deletions: 0, insertionsAccepted: 0, comments: 0, hiddenRuns: 0, properties: false }
  const hidden = hiddenStyles(await zip.file('word/styles.xml')?.async('string'))

  for (const name of Object.keys(zip.files)) {
    const file = zip.files[name]
    if (file.dir) continue
    if (TEXT_PARTS.test(name)) {
      zip.file(name, cleanTextPart(await file.async('string'), hidden, removed))
    } else if (COMMENT_PARTS.test(name)) {
      zip.file(name, emptyRoot(await file.async('string')))
    } else if (EMPTY_PROPERTIES[name]) {
      zip.file(name, EMPTY_PROPERTIES[name])
      removed.properties = true
    }
  }

  return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), removed }
}

module.exports = { sanitizeDocx }
