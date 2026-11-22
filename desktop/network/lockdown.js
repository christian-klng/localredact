// Keeps the app's windows off the network. LocalRedact must work, and be
// trusted to work, without any connection leaving the computer, so this is
// enforced here rather than left to each feature:
//
// - name resolution is switched off for everything except localhost,
// - every request to another machine is cancelled and recorded,
// - Chromium's own background services (updates, reporting, sync) are off.
const { app } = require('electron')

const blocked = []

function isLoopbackHost(hostname) {
  const name = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return name === 'localhost' || name === '::1' || name.startsWith('127.')
}

// Requests that cannot leave the machine: local schemes and loopback addresses.
function staysLocal(url) {
  let parsed
  try { parsed = new URL(url) } catch { return false }
  if (['data:', 'blob:', 'file:', 'about:', 'devtools:', 'chrome:'].includes(parsed.protocol)) return true
  if (['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return isLoopbackHost(parsed.hostname)
  return false
}

// Records where a request wanted to go, not the full URL, which could carry data.
function recordBlocked(url) {
  let target = url
  try { target = new URL(url).origin } catch { /* keep as is */ }
  blocked.push(target)
  console.warn(`[network-lockdown] blocked ${target}`)
}

function lockDownSession(ses) {
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (staysLocal(details.url)) return callback({ cancel: false })
    recordBlocked(details.url)
    callback({ cancel: true })
  })
  // Dictionaries for the spell checker would be downloaded on first use.
  ses.setSpellCheckerEnabled(false)
}

// Must run before the app is ready: command-line switches only apply then.
function lockDownNetwork() {
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1')
  for (const flag of ['disable-background-networking', 'disable-component-update', 'disable-domain-reliability', 'disable-sync', 'no-pings']) {
    app.commandLine.appendSwitch(flag)
  }
  // Covers the default session and any created later.
  app.on('session-created', lockDownSession)
}

module.exports = { lockDownNetwork, recordBlocked, blockedRequests: () => [...blocked] }
