// Builds the Next.js standalone server for the desktop app and completes it:
// `next build` leaves static assets, public files and translations outside
// `.next/standalone`. Runs the same way on macOS, Windows and Linux.
import { execSync } from 'node:child_process'
import { cp, access, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const standalone = join(root, '.next', 'standalone')
const models = join(root, 'desktop', 'models')
const ortDist = join(root, 'node_modules', 'onnxruntime-web', 'dist')

// With the model fetched (`npm run fetch:models`), the app serves it and the
// ONNX runtime itself and never downloads them. Without it the build still
// works but falls back to downloading on first use, which is only acceptable
// for automated start-up checks, never for a release.
const hasModels = await access(join(models, 'openai', 'privacy-filter', 'config.json')).then(() => true, () => false)
if (!hasModels) console.warn('WARNING: desktop/models is empty - this build will download the NER model at runtime. Run "npm run fetch:models" first for an offline build.')

// The pages read these settings again when the server starts (the desktop
// shell passes them there too); setting them here keeps the prerendered HTML
// consistent with that.
execSync('npm run build', {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CLOUD_AI: 'false', NER_MODELS: hasModels ? 'local' : 'remote', NEXT_TELEMETRY_DISABLED: '1' },
})

await access(join(standalone, 'server.js')).catch(() => {
  throw new Error(`Build finished without a standalone server at ${standalone}.`)
})

const copies = [
  [join(root, '.next', 'static'), join(standalone, '.next', 'static')],
  [join(root, 'public'), join(standalone, 'public')],
  [join(root, 'messages'), join(standalone, 'messages')],
]
for (const [from, to] of copies) {
  // `public` is optional: the project may have no static files of its own.
  if (await access(from).then(() => true, () => false)) await cp(from, to, { recursive: true })
}

if (hasModels) {
  await cp(models, join(standalone, 'public', 'models'), { recursive: true })
  // The WebAssembly runtime that would otherwise be loaded from a CDN.
  const ortTarget = join(standalone, 'public', 'ort')
  await mkdir(ortTarget, { recursive: true })
  for (const file of await readdir(ortDist)) {
    if (file.startsWith('ort-wasm')) await cp(join(ortDist, file), join(ortTarget, file))
  }
}

// File tracing can pull the desktop shell itself into the server bundle.
await rm(join(standalone, 'desktop'), { recursive: true, force: true })

console.log(`Standalone server ready at ${standalone}`)
