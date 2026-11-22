// Electron shell for LocalRedact: runs the bundled Next.js server in a utility
// process bound to the loopback interface and shows it in a sandboxed window.
const { app, BrowserWindow, utilityProcess } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const net = require('node:net')
const http = require('node:http')
const crypto = require('node:crypto')
const { convertDocx } = require('./docx/convert')
const { lockDownNetwork, blockedRequests } = require('./network/lockdown')

lockDownNetwork()

const HOST = '127.0.0.1'
const LOCALES = ['en', 'de', 'fr', 'es', 'ru', 'ar', 'zh']
// Smoke mode loads the app once, reports what it saw and exits — used to check
// a packaged build without a person looking at it.
const SMOKE = process.env.LOCALREDACT_SMOKE === '1' || process.argv.includes('--smoke')

const serverDir = app.isPackaged
  ? path.join(process.resourcesPath, 'server')
  : path.join(__dirname, '..', '.next', 'standalone')

let server = null
// Connections the server process tried to open to another machine and its
// network guard refused.
let serverBlocked = 0
let serverGuardActive = false
// Set when the page reports that the NER model runs in the server process.
let nerOnServer = false

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, HOST, () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

function waitForServer(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({ host: HOST, port, path: '/api/rules', timeout: 2000 }, res => {
        res.resume()
        resolve()
      })
      const retry = () => {
        req.destroy()
        if (Date.now() > deadline) reject(new Error('Server did not start in time'))
        else setTimeout(attempt, 200)
      }
      req.once('error', retry)
      req.once('timeout', retry)
    }
    attempt()
  })
}

// DOCX conversion needs a browser window to print from, which only this process
// has. The bundled server reaches it through a loopback endpoint that accepts
// nothing without the token generated for this run.
const MAX_DOCX_BYTES = 200 * 1024 * 1024

function startDocxService() {
  const token = crypto.randomBytes(32).toString('hex')
  const service = http.createServer(async (req, res) => {
    const fail = (status, message) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: message }))
    }
    if (req.method !== 'POST' || req.url !== '/convert') return fail(404, 'Not found')
    if (req.headers.authorization !== `Bearer ${token}`) return fail(401, 'Unauthorized')
    try {
      const chunks = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > MAX_DOCX_BYTES) return fail(413, 'The document is too large.')
        chunks.push(chunk)
      }
      const { pdf, engine, removed } = await convertDocx(Buffer.concat(chunks))
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'X-Docx-Engine': engine,
        'X-Docx-Removed': JSON.stringify(removed),
      })
      res.end(pdf)
    } catch (err) {
      console.error('DOCX conversion failed:', err)
      fail(500, 'The document could not be converted.')
    }
  })
  return new Promise((resolve, reject) => {
    service.once('error', reject)
    service.listen(0, HOST, () => resolve({ url: `http://${HOST}:${service.address().port}/convert`, token }))
  })
}

async function startServer() {
  const port = await freePort()
  const docxService = await startDocxService()
  // The entry file installs the network guard and then starts the server.
  server = utilityProcess.fork(path.join(serverDir, 'server-entry.js'), [], {
    cwd: serverDir,
    serviceName: 'LocalRedact Server',
    stdio: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: HOST,
      NEXT_TELEMETRY_DISABLED: '1',
      LOCAL_AI: 'ner-browser',
      REDACTION_RULES_SOURCE: 'local',
      DOCX_CONVERTER_URL: docxService.url,
      DOCX_CONVERTER_TOKEN: docxService.token,
      // Use the bundled NER model when the build contains one; nothing is then
      // downloaded at runtime.
      NER_MODELS: fs.existsSync(path.join(serverDir, 'public', 'models')) ? 'local' : 'remote',
    },
  })
  server.stdout?.on('data', d => process.stdout.write(`[server] ${d}`))
  server.stderr?.on('data', d => {
    serverBlocked += String(d).split('[network-guard] blocked').length - 1
    if (String(d).includes('[network-guard] active')) serverGuardActive = true
    process.stderr.write(`[server] ${d}`)
  })
  server.once('exit', code => {
    server = null
    if (!app.isQuitting) {
      console.error(`Server exited unexpectedly (code ${code})`)
      app.exit(1)
    }
  })
  await waitForServer(port)
  return `http://${HOST}:${port}`
}

function pickLocale() {
  const lang = app.getLocale().split('-')[0]
  return LOCALES.includes(lang) ? lang : 'en'
}

async function createWindow(origin) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: !SMOKE,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  })
  // The window only ever shows the bundled app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault()
  })
  // In the self-test, problems reported by the page belong in the log.
  if (SMOKE) {
    win.webContents.on('console-message', event => {
      if (String(event.message).includes('using the server instead')) nerOnServer = true
      if (['warning', 'error'].includes(event.level)) console.log(`[page ${event.level}] ${String(event.message).slice(0, 400)}`)
    })
  }
  // The self-test reads German labels, so it does not follow the system language.
  await win.loadURL(`${origin}/${SMOKE ? 'de' : pickLocale()}/app`)
  return win
}

// A host that can never exist, used to prove that the block is active without
// contacting anyone.
const CONTROL_URL = 'https://network-check.invalid/'
const NER_TIMEOUT_MS = Number(process.env.LOCALREDACT_SMOKE_NER_TIMEOUT_MS ?? 5 * 60_000)

// Self-test of a build: starts the app, and - given a DOCX - runs the whole
// path a user would: convert it, open the PDF, let the bundled model analyse
// it. It fails if any step fails or if anything tried to reach another machine.
async function smokeTest(win, origin) {
  const run = script => win.webContents.executeJavaScript(`(async () => { ${script} })()`)

  // The app renders client-side, so give the UI a moment to appear.
  const result = await run(`
    const deadline = Date.now() + 15000
    while (!document.querySelector('button') && Date.now() < deadline)
      await new Promise(r => setTimeout(r, 200))
    return {
      title: document.title,
      path: location.pathname,
      config: window.__ER_CFG__,
      rulesStatus: (await fetch('/api/rules')).status,
      hasBody: !!document.querySelector('button'),
    }
  `)
  let ok = result.rulesStatus === 200 && result.hasBody

  // The control: a separate window tries to open an outside address. A request
  // from the app page would not do, because the page's own security policy
  // refuses it before the network block is even asked.
  const probe = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  const controlError = await probe.loadURL(CONTROL_URL).then(() => null, err => err.code ?? String(err))
  probe.destroy()

  const docxPath = process.env.LOCALREDACT_SMOKE_DOCX
  if (docxPath) {
    const base64 = fs.readFileSync(docxPath).toString('base64')
    // Convert through the app's own upload route and keep the PDF in the page.
    result.docx = await run(`
      const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), c => c.charCodeAt(0))
      const form = new FormData()
      form.append('file', new File([bytes], 'smoke.docx'))
      const res = await fetch('/api/docx', { method: 'POST', body: form })
      const pdf = new Uint8Array(await res.arrayBuffer())
      window.__smokePdf = pdf
      return {
        status: res.status,
        engine: res.headers.get('X-Docx-Engine'),
        removed: res.headers.get('X-Docx-Removed'),
        bytes: pdf.length,
        isPdf: String.fromCharCode(...pdf.slice(0, 5)) === '%PDF-',
      }
    `)
    ok &&= result.docx.isPdf

    if (result.docx.isPdf && result.config?.nerModels === 'local') {
      // Open the PDF the way a user would and wait for the model's findings.
      result.ner = await run(`
        const transfer = new DataTransfer()
        transfer.items.add(new File([window.__smokePdf], 'smoke.pdf', { type: 'application/pdf' }))
        const input = document.querySelector('input[type=file]')
        input.files = transfer.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
        const started = Date.now()
        const count = label => Number((document.body.innerText.match(new RegExp(label + '\\\\s*(\\\\d+)')) ?? [])[1] ?? 0)
        while (Date.now() - started < ${NER_TIMEOUT_MS}) {
          if (count('Personen') > 0) break
          await new Promise(r => setTimeout(r, 500))
        }
        return { persons: count('Personen'), addresses: count('Orte'), seconds: Math.round((Date.now() - started) / 1000) }
      `)
      result.ner.ranOn = nerOnServer ? 'server (processor)' : 'window (graphics card)'
      ok &&= result.ner.persons > 0
    } else if (result.docx.isPdf) {
      result.ner = 'skipped: this build has no bundled model'
    }
  }

  // Everything the windows or the server tried to reach elsewhere. Only the
  // deliberate control request may appear, and it must appear.
  const control = new URL(CONTROL_URL).origin
  const attempts = blockedRequests()
  result.network = {
    controlBlocked: controlError === 'ERR_BLOCKED_BY_CLIENT' && attempts.includes(control),
    blockedFromWindows: attempts.filter(target => target !== control),
    serverGuardActive,
    blockedFromServer: serverBlocked,
  }
  ok &&= result.network.controlBlocked && result.network.blockedFromWindows.length === 0
  ok &&= serverGuardActive && serverBlocked === 0

  console.log(`SMOKE ${JSON.stringify({ ok, origin, ...result })}`)
  return ok
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('before-quit', () => {
    app.isQuitting = true
    server?.kill()
  })
  app.on('window-all-closed', () => app.quit())

  app.whenReady().then(async () => {
    try {
      const origin = await startServer()
      const win = await createWindow(origin)
      if (SMOKE) {
        const ok = await smokeTest(win, origin)
        app.isQuitting = true
        server?.kill()
        app.exit(ok ? 0 : 1)
      }
    } catch (err) {
      console.error(err)
      app.isQuitting = true
      server?.kill()
      app.exit(1)
    }
  })
}
