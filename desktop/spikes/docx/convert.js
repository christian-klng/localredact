// Spike: converts a DOCX to PDF two ways, each printed by Chromium:
// via mammoth (DOCX -> semantic HTML) and via docx-preview (DOCX rendered in the page).
// Needs mammoth, docx-preview and jszip installed next to this file.
//
// Usage: electron convert.js <in.docx> <outDir>
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const mammoth = require('mammoth')

const [input, outDir] = process.argv.slice(2).filter(a => !a.startsWith('--')).map(a => path.resolve(a))
const name = path.basename(input, '.docx')
const pdfOptions = { printBackground: true, pageSize: 'A4', preferCSSPageSize: true }

async function toPdf(win, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, await win.webContents.printToPDF(pdfOptions))
}

async function viaMammoth() {
  const { value: html, messages } = await mammoth.convertToHtml({ path: input })
  const page = `<!doctype html><meta charset="utf-8"><style>@page{size:A4;margin:25mm}body{font:11pt/1.4 Arial,sans-serif}table{border-collapse:collapse}td,th{border:1px solid #444;padding:4px}</style>${html}`
  const file = path.join(outDir, 'mammoth', `${name}.html`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, page)
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } })
  await win.loadFile(file)
  await toPdf(win, path.join(outDir, 'mammoth', `${name}.pdf`))
  win.destroy()
  return messages.map(m => m.message)
}

async function viaDocxPreview() {
  const dir = path.join(outDir, 'docx-preview')
  fs.mkdirSync(dir, { recursive: true })
  for (const lib of ['jszip/dist/jszip.min.js', 'docx-preview/dist/docx-preview.min.js']) {
    fs.copyFileSync(path.join(__dirname, 'node_modules', lib), path.join(dir, path.basename(lib)))
  }
  const file = path.join(dir, `${name}.html`)
  fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><style>@page{size:A4;margin:0}body{margin:0}.docx-wrapper{background:none!important;padding:0!important}.docx-wrapper>section.docx{box-shadow:none!important;margin:0!important}</style><div id="c"></div><script src="jszip.min.js"></script><script src="docx-preview.min.js"></script>`)
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  await win.loadFile(file)
  const b64 = fs.readFileSync(input).toString('base64')
  await win.webContents.executeJavaScript(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0))
    await docx.renderAsync(new Blob([bytes]), document.getElementById('c'), null, {
      renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
      renderChanges: false, renderComments: false, breakPages: true, ignoreLastRenderedPageBreak: true,
    })
    await document.fonts.ready
  })()`)
  await toPdf(win, path.join(dir, `${name}.pdf`))
  win.destroy()
}

app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  try {
    const warnings = await viaMammoth()
    console.log('mammoth ok', JSON.stringify(warnings))
    await viaDocxPreview()
    console.log('docx-preview ok')
    app.exit(0)
  } catch (err) { console.error(err); app.exit(1) }
})
