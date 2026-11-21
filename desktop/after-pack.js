// Copies the Next.js standalone server into the packaged app. electron-builder's
// `extraResources` drops `node_modules` folders, which the server needs, so the
// copy happens here — after packing and before code signing.
const { cp, access } = require('node:fs/promises')
const path = require('node:path')

exports.default = async function afterPack(context) {
  const source = path.join(__dirname, '..', '.next', 'standalone')
  await access(path.join(source, 'server.js')).catch(() => {
    throw new Error(`No standalone build at ${source} — run "npm run build:server" first.`)
  })

  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources')

  await cp(source, path.join(resources, 'server'), { recursive: true })
}
