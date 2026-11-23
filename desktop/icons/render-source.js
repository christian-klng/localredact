// Renders source.svg to source.png (black on transparent, 1024 px), which
// make-icons.py builds every icon from. Run it with Electron, because Chromium
// draws the SVG exactly:
//
//   desktop/node_modules/.bin/electron desktop/icons/render-source.js
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const SIZE = 1024

app.whenReady().then(async () => {
  try {
    const svg = fs.readFileSync(path.join(__dirname, 'source.svg'), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/width="24" height="24"/, `width="${SIZE}" height="${SIZE}"`)
    const win = new BrowserWindow({
      show: false, frame: false, transparent: true, useContentSize: true, width: SIZE, height: SIZE,
      webPreferences: { offscreen: true, sandbox: true },
    })
    const page = `<body style="margin:0;background:transparent;overflow:hidden">${svg}</body>`
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)
    await new Promise(resolve => setTimeout(resolve, 300))
    const image = (await win.webContents.capturePage()).resize({ width: SIZE, height: SIZE })
    fs.writeFileSync(path.join(__dirname, 'source.png'), image.toPNG())
    app.exit(0)
  } catch (err) {
    console.error(err)
    app.exit(1)
  }
})
