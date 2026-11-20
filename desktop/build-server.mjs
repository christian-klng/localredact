// Builds the Next.js standalone server for the desktop app and completes it:
// `next build` leaves static assets, public files and translations outside
// `.next/standalone`. Runs the same way on macOS, Windows and Linux.
import { execSync } from 'node:child_process'
import { cp, access, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const standalone = join(root, '.next', 'standalone')

// The cloud option is baked into the prerendered pages, so it has to be off at
// build time, not only when the server starts.
execSync('npm run build', {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CLOUD_AI: 'false', NEXT_TELEMETRY_DISABLED: '1' },
})

await access(join(standalone, 'server.js')).catch(() => {
  throw new Error(`Build finished without a standalone server at ${standalone}.`)
})

const copies = [
  [join(root, '.next', 'static'), join(standalone, '.next', 'static')],
  [join(root, 'public'), join(standalone, 'public')],
  [join(root, 'messages'), join(standalone, 'messages')],
]
for (const [from, to] of copies) await cp(from, to, { recursive: true })

// File tracing can pull the desktop shell itself into the server bundle.
await rm(join(standalone, 'desktop'), { recursive: true, force: true })

console.log(`Standalone server ready at ${standalone}`)
