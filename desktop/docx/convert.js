// Converts a DOCX to PDF inside the desktop app. The file is cleaned first (see
// sanitize.js) and then converted by LibreOffice when it is installed, because
// that stays closest to the original layout, or else by the built-in renderer,
// which needs nothing installed.
//
// LOCALREDACT_DOCX_ENGINE=builtin|libreoffice forces one of the two.
const { BrowserWindow, session } = require('electron')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { sanitizeDocx } = require('./sanitize')

const RENDER_PAGE = path.join(__dirname, 'render.html')
const LIBREOFFICE_TIMEOUT_MS = 120_000

function findLibreOffice() {
  const candidates = [
    process.env.LIBREOFFICE_PATH,
    ...(process.platform === 'darwin' ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice'] : []),
    ...(process.platform === 'win32'
      ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(dir => path.join(dir, 'LibreOffice', 'program', 'soffice.exe'))
      : []),
    ...(process.platform === 'linux'
      ? ['/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/local/bin/soffice', '/opt/libreoffice/program/soffice', '/snap/bin/libreoffice']
      : []),
  ]
  return candidates.find(file => file && fs.existsSync(file)) ?? null
}

async function viaLibreOffice(soffice, docx) {
  // A private profile keeps this run apart from a LibreOffice the user has open.
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'localredact-docx-'))
  try {
    const input = path.join(dir, 'document.docx')
    await fs.promises.writeFile(input, docx)
    await new Promise((resolve, reject) => {
      execFile(soffice, [
        `-env:UserInstallation=${pathToFileURL(path.join(dir, 'profile')).href}`,
        '--headless', '--convert-to', 'pdf', '--outdir', dir, input,
      ], { timeout: LIBREOFFICE_TIMEOUT_MS }, err => (err ? reject(err) : resolve()))
    })
    return await fs.promises.readFile(path.join(dir, 'document.pdf'))
  } finally {
    // The folder holds the document itself, so it must not be left behind.
    await fs.promises.rm(dir, { recursive: true, force: true })
  }
}

let renderSession = null

// The render window only ever needs the files of this app. Everything else,
// such as an image a document links to on the internet, is refused.
function getRenderSession() {
  if (renderSession) return renderSession
  renderSession = session.fromPartition('docx-render')
  const appRoot = pathToFileURL(path.join(__dirname, '..')).href
  renderSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith(appRoot) || /^(data|blob):/.test(details.url)
    callback({ cancel: !allowed })
  })
  return renderSession
}

async function viaBuiltIn(docx) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { session: getRenderSession(), sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  try {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', event => event.preventDefault())
    await win.loadFile(RENDER_PAGE)
    const { headerTemplate, footerTemplate } = await win.webContents.executeJavaScript(
      `renderDocx(${JSON.stringify(docx.toString('base64'))})`,
    )
    return await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      // Without a template Chromium prints its own header and footer (date,
      // title, page number), so an empty one is passed explicitly.
      displayHeaderFooter: !!(headerTemplate || footerTemplate),
      headerTemplate: headerTemplate || '<span></span>',
      footerTemplate: footerTemplate || '<span></span>',
    })
  } finally {
    win.destroy()
  }
}

/**
 * @param {Buffer} input the DOCX as uploaded
 * @returns {Promise<{ pdf: Buffer, engine: 'libreoffice' | 'builtin', removed: object }>}
 */
async function convertDocx(input) {
  const { buffer, removed } = await sanitizeDocx(input)
  const forced = process.env.LOCALREDACT_DOCX_ENGINE
  const soffice = forced === 'builtin' ? null : findLibreOffice()

  if (soffice) {
    try {
      return { pdf: await viaLibreOffice(soffice, buffer), engine: 'libreoffice', removed }
    } catch (err) {
      if (forced === 'libreoffice') throw err
      console.error('LibreOffice conversion failed, using the built-in renderer instead:', err.message)
    }
  } else if (forced === 'libreoffice') {
    throw new Error('LibreOffice was not found on this computer.')
  }
  return { pdf: await viaBuiltIn(buffer), engine: 'builtin', removed }
}

module.exports = { convertDocx, findLibreOffice }
