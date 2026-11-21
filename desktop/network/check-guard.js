// Checks the server-side network guard on its own: connections to other
// machines must be refused, connections to this machine must still work.
// No request leaves the computer; the outside targets are never contacted.
//
//   node desktop/network/check-guard.js
require('./guard')
const http = require('node:http')

const get = url => new Promise(resolve => {
  http.get(url, res => { res.resume(); resolve('connected') }).on('error', err => resolve(err.code))
})

async function main() {
  const results = {
    // By name (via fetch) and by address (no lookup involved).
    fetchByName: await fetch('https://network-check.invalid/').then(() => 'connected', err => err.cause?.code ?? err.code),
    getByAddress: await get('http://192.0.2.1/'), // reserved for documentation, never routed
  }

  const local = http.createServer((_req, res) => res.end('ok'))
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve))
  results.loopback = await fetch(`http://127.0.0.1:${local.address().port}`).then(res => res.text(), err => String(err))
  local.close()

  const ok = results.fetchByName === 'ENETUNREACH' && results.getByAddress === 'ENETUNREACH' && results.loopback === 'ok'
  console.log(`${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(results)}`)
  process.exit(ok ? 0 : 1)
}

main()
