// Loaded into the bundled server process before any other code (see
// server-entry.js).
// It refuses every outgoing connection that does not go to this computer
// itself, so that no code running in the server - the app's own, a dependency's
// or a misconfigured endpoint - can reach the network.
//
// It announces itself on stderr when loaded, and writes each refusal there with
// the prefix below; the desktop shell reads both in its self-test.
const net = require('node:net')
const dns = require('node:dns')

const PREFIX = '[network-guard] blocked'

function isLoopback(host) {
  if (host === undefined || host === null || host === '') return true // Node's default is localhost
  const name = String(host).toLowerCase().replace(/^\[|\]$/g, '')
  return name === 'localhost' || name === '::1' || name.startsWith('127.') || name.startsWith('::ffff:127.')
}

function refuse(target) {
  process.stderr.write(`${PREFIX} ${target}\n`)
  const error = new Error(`Outgoing connection to ${target} refused: LocalRedact works offline.`)
  error.code = 'ENETUNREACH'
  return error
}

// connect(options), connect(port, host), connect(path) and Node's internal
// pre-normalised form all end up here.
function targetOf(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  if (typeof first === 'string') return { path: first }
  if (typeof first === 'number') return { port: first, host: typeof args[1] === 'string' ? args[1] : undefined }
  return first ?? {}
}

const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function guardedConnect(...args) {
  const { host, port, path } = targetOf(args)
  // Local pipes and sockets stay on this machine by definition.
  if (path || isLoopback(host)) return connect.apply(this, args)
  const error = refuse(`${host}:${port}`)
  process.nextTick(() => this.destroy(error))
  return this
}

// Looking a name up would already send it to a DNS server.
const lookup = dns.lookup
dns.lookup = function guardedLookup(hostname, options, callback) {
  if (isLoopback(hostname) || net.isIP(hostname)) return lookup.call(dns, hostname, options, callback)
  const done = typeof options === 'function' ? options : callback
  const error = refuse(`lookup of ${hostname}`)
  process.nextTick(() => done(error))
  return {}
}
const lookupAsync = dns.promises.lookup
dns.promises.lookup = function guardedLookupAsync(hostname, options) {
  if (isLoopback(hostname) || net.isIP(hostname)) return lookupAsync.call(dns.promises, hostname, options)
  return Promise.reject(refuse(`lookup of ${hostname}`))
}

process.stderr.write('[network-guard] active\n')

module.exports = { PREFIX }
