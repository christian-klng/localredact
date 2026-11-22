// Spike: how reliably does a local model drive the assistant's tool calls?
//
// Starts the built Next.js server against a local OpenAI-compatible endpoint,
// sends a sample document through the real /api/chat route and scores the
// redaction suggestions against the personal data known to be in the document.
//
//   node desktop/spikes/llm-eval.mjs <model> [--runs 3] [--mode pii|foi]
//                                    [--base http://localhost:11434/v1] [--preload]
//                                    [--reasoning none|low|medium|high]
//
// Requires a standalone build (`npm run build:server` in desktop/).
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const serverDir = join(here, '..', '..', '.next', 'standalone')

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const model = args[0]
if (!model || model.startsWith('--')) {
  console.error('Usage: node desktop/spikes/llm-eval.mjs <model> [--runs 3] [--mode pii|foi] [--base URL]')
  process.exit(2)
}
const runs = Number(flag('runs', 3))
const mode = flag('mode', 'pii')
const base = flag('base', 'http://localhost:11434/v1')
const preload = args.includes('--preload')
const reasoning = flag('reasoning', '')
const MAX_TURNS = 4
const TURN_TIMEOUT_MS = 15 * 60_000

const sample = JSON.parse(await readFile(join(here, 'sample-document.json'), 'utf8'))
const norm = s => s.replace(/\s+/g, ' ').trim().toLowerCase()
const fullText = norm(sample.pages.map(p => p.text).join(' '))

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(port))
  })
})

async function startServer() {
  const port = await freePort()
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serverDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      NEXT_TELEMETRY_DISABLED: '1',
      LOCAL_AI: 'llm',
      LOCAL_LLM_API_BASE: base,
      LOCAL_LLM_API_KEY: 'local',
      LOCAL_LLM_MODEL: model,
      REDACTION_RULES_SOURCE: 'local',
      PRELOAD_DOCUMENT: preload ? 'true' : 'false',
      ...(reasoning ? { LOCAL_LLM_REASONING_EFFORT: reasoning } : {}),
    },
  })
  const warnings = []
  child.stderr.on('data', d => warnings.push(String(d)))
  const origin = `http://127.0.0.1:${port}`
  for (let i = 0; i < 150; i++) {
    try { await fetch(`${origin}/api/rules`); return { child, origin, warnings } } catch { await new Promise(r => setTimeout(r, 200)) }
  }
  child.kill()
  throw new Error('Server did not start')
}

// One request to /api/chat; returns the parsed SSE events. Uses node:http rather
// than fetch because a slow local model can stay silent for longer than fetch's
// built-in five-minute timeout.
function chatTurn(origin, messages) {
  const body = JSON.stringify({
    messages,
    model: 'local',
    aiMode: 'local',
    redactionMode: mode,
    foiJurisdiction: mode === 'foi' ? 'de-ifg-bund' : undefined,
    documentPages: sample.pages.map((p, pageIndex) => ({
      documentKey: 'sample', documentName: sample.name, pageIndex, text: p.text,
    })),
    currentRedactions: [],
    locale: 'de',
    primaryDocumentKey: 'sample',
    primaryDocumentName: sample.name,
  })
  return new Promise((resolve, reject) => {
    const req = request(`${origin}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      const events = []
      let buffer = ''
      res.setEncoding('utf8')
      res.on('data', chunk => {
        buffer += chunk
        let end
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const line = buffer.slice(0, end).trim()
          buffer = buffer.slice(end + 2)
          if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)))
        }
      })
      res.on('end', () => resolve(events))
      res.on('error', reject)
    })
    req.setTimeout(TURN_TIMEOUT_MS, () => req.destroy(new Error(`No reply within ${TURN_TIMEOUT_MS / 60000} minutes`)))
    req.on('error', reject)
    req.end(body)
  })
}

async function runOnce(origin) {
  const started = Date.now()
  const messages = [{ role: 'user', content: sample.request[mode] }]
  const result = {
    toolCalls: [], questions: 0, errors: [], suggestions: [], ranges: 0, pageRanges: 0, failedToolResults: 0, toolErrors: [], text: '',
  }

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const events = await chatTurn(origin, messages)
    let text = ''
    let question = null
    for (const e of events) {
      if (e.type === 'text_delta') text += e.content
      if (e.type === 'tool_start') result.toolCalls.push(e.name)
      if (e.type === 'tool_result' && !e.success) { result.failedToolResults++; result.toolErrors.push(String(e.result).slice(0, 140)) }
      if (e.type === 'error') result.errors.push(e.message)
      if (e.type === 'ask_user') question = e.question
      if (e.type === 'suggest_redactions') {
        result.suggestions.push(...e.suggestions)
        result.ranges += e.textRanges.length
        result.pageRanges += e.pageRanges.length
      }
    }
    result.text += text
    if (!question) break
    // Answer the way a user who wants everything personal redacted would.
    result.questions++
    messages.push({ role: 'assistant', content: `${text}\n${question.question}`.trim() })
    messages.push({ role: 'user', content: sample.answer })
  }

  const suggested = [...new Set(result.suggestions.map(s => norm(s.text)))]
  const covered = e => suggested.some(s => s.includes(norm(e)) || norm(e).includes(s) && s.length >= 4)
  const found = sample.expected.filter(covered)
  const missed = sample.expected.filter(e => !covered(e))
  const notInDocument = suggested.filter(s => !fullText.includes(s))
  const keptPublic = sample.mustKeep.filter(k => suggested.some(s => s.includes(norm(k))))

  return {
    seconds: Math.round((Date.now() - started) / 1000),
    toolCalls: result.toolCalls.join(' → ') || '(none)',
    questions: result.questions,
    suggestions: suggested.length,
    ranges: result.ranges,
    pageRanges: result.pageRanges,
    recall: `${found.length}/${sample.expected.length}`,
    missed,
    notInDocument,
    wronglyRedacted: keptPublic,
    failedToolResults: result.failedToolResults,
    toolErrors: result.toolErrors,
    errors: result.errors,
    replyStart: result.text.trim().slice(0, 160),
  }
}

const { child, origin, warnings } = await startServer()
try {
  console.log(`# ${model} — mode ${mode}, ${runs} run(s), preload ${preload}, reasoning ${reasoning || 'default'}, endpoint ${base}`)
  for (let i = 1; i <= runs; i++) {
    const r = await runOnce(origin).catch(err => ({ crashed: String(err) }))
    console.log(`\n## run ${i}\n${JSON.stringify(r, null, 2)}`)
  }
  const retries = warnings.join('').split('\n').filter(l => l.includes('[chat]'))
  console.log(`\n## server warnings: ${retries.length}`)
  for (const line of retries.slice(0, 12)) console.log(line.slice(0, 200))
} finally {
  child.kill()
}
