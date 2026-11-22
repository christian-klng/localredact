// Part of the self-test: several documents open at once.
//
// Findings must stay with the document they were found in, whatever the user
// does meanwhile. This opens two documents with different people in them,
// switches between them while they load, switches a category off and on again
// while switching some more, and then checks that each document still has
// exactly its own findings.
const { BrowserWindow } = require('electron')

const DOCUMENTS = [
  { name: 'selftest-a.pdf', lines: ['Bescheid Nummer eins', 'Antragstellerin ist Frau Lena Hoffmann aus Neuenkirchen.', 'Telefon: 05973 884512'], own: 'Lena Hoffmann', foreign: 'Berger' },
  { name: 'selftest-b.pdf', lines: ['Bescheid Nummer zwei', 'Zeugin ist Frau Maria Berger-Yilmaz aus Rheine.', 'Ihr Bruder ist Herr Thomas Berger.', 'Mobil: 0171 5550142'], own: 'Maria Berger-Yilmaz', foreign: 'Hoffmann' },
]
const SETTLE_TIMEOUT_MS = 180_000

async function textPdf(lines) {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    const html = `<body style="font: 14pt sans-serif">${lines.map(line => `<p>${line}</p>`).join('')}</body>`
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return (await win.webContents.printToPDF({})).toString('base64')
  } finally {
    win.destroy()
  }
}

// Runs inside the app page. Kept as one function so it can be read as a whole;
// it is serialised and called with the documents as its argument.
async function scenario(documents, settleTimeoutMs) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const names = documents.map(d => d.name)
  const button = label => [...document.querySelectorAll('button')].find(b => b.innerText.trim() === label)
  const show = name => button(name)?.click()
  const toggle = label => [...document.querySelectorAll('button')].find(b => b.innerText.trim().startsWith(label))?.click()

  // The suggested redactions per document, as the app has stored them.
  const stored = () => new Promise((resolve, reject) => {
    const open = indexedDB.open('easy-redact')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const get = open.result.transaction('session').objectStore('session').get('current')
      get.onerror = () => reject(get.error)
      get.onsuccess = () => {
        const session = get.result
        const perDocument = {}
        for (const name of names) {
          const key = session.documents.find(d => d.name === name)?.idbKey
          perDocument[name] = session.redactions
            .filter(r => r.documentKey === key && r.status === 'suggested')
            .map(r => `${r.reason}: ${(r.searchText ?? '').replace(/\s+/g, ' ')}`)
            .sort()
        }
        resolve(perDocument)
      }
    }
  })

  const persons = list => list.filter(entry => entry.includes('PER')).length
  // Show each document in turn until both have findings for persons.
  const settle = async () => {
    const deadline = Date.now() + settleTimeoutMs
    for (;;) {
      for (const name of names) { show(name); await sleep(2500) }
      const state = await stored()
      if (names.every(name => persons(state[name]) > 0) || Date.now() > deadline) return state
    }
  }
  const switchRapidly = async () => {
    for (const pause of [0, 15, 40, 90, 200, 400]) {
      for (const name of names) { await sleep(pause); show(name) }
    }
  }

  // Open both at once and switch between them while they are still loading.
  const transfer = new DataTransfer()
  for (const d of documents) {
    const bytes = Uint8Array.from(atob(d.base64), c => c.charCodeAt(0))
    transfer.items.add(new File([bytes], d.name, { type: 'application/pdf' }))
  }
  const input = document.querySelector('input[type=file]')
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await switchRapidly()
  const before = await settle()

  // Switch a category off and on again, twice, switching documents throughout.
  for (let round = 0; round < 2; round++) {
    toggle('Personen')
    await sleep(300)
    toggle('Personen')
    await switchRapidly()
  }
  // Give every queued finding the chance to be applied in its own document.
  let after = await settle()
  for (let i = 0; i < 2; i++) {
    for (const name of names) { show(name); await sleep(2500) }
    after = await stored()
  }

  return { before, after }
}

/**
 * @param {Electron.BrowserWindow} win the app window, with the model already loaded
 * @returns {Promise<{ ok: boolean, problems: string[], counts: object }>}
 */
async function testSeveralDocuments(win) {
  const documents = []
  for (const d of DOCUMENTS) documents.push({ name: d.name, base64: await textPdf(d.lines) })

  const { before, after } = await win.webContents.executeJavaScript(
    `(${scenario.toString()})(${JSON.stringify(documents)}, ${SETTLE_TIMEOUT_MS})`,
  )

  const problems = []
  for (const d of DOCUMENTS) {
    const first = before[d.name]
    const last = after[d.name]
    if (!first.some(entry => entry.includes(d.own))) problems.push(`${d.name}: "${d.own}" was not found`)
    if (first.some(entry => entry.includes(d.foreign))) problems.push(`${d.name}: has a finding from the other document`)
    if (JSON.stringify(first) !== JSON.stringify(last)) {
      problems.push(`${d.name}: findings changed after switching (${first.length} before, ${last.length} after)`)
    }
  }
  const counts = Object.fromEntries(DOCUMENTS.map(d => [d.name, { before: before[d.name].length, after: after[d.name].length }]))
  return { ok: problems.length === 0, problems, counts }
}

module.exports = { testSeveralDocuments }
