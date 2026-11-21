// Downloads the NER model that ships inside the desktop app into desktop/models.
// The revision is pinned and every file is checked against its known size and
// SHA-256, so a build always contains exactly this model. Files that are already
// present and intact are not downloaded again.
//
//   node desktop/fetch-models.mjs
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const MODEL = 'openai/privacy-filter' // Apache-2.0
const REVISION = '7ffa9a043d54d1be65afb281eddf0ffbe629385b'
const FILES = [
  { path: 'config.json', size: 3039 },
  { path: 'tokenizer_config.json', size: 234 },
  { path: 'tokenizer.json', size: 27868174, sha256: '0614fe83cadab421296e664e1f48f4261fa8fef6e03e63bb75c20f38e37d07d3' },
  { path: 'onnx/model_q4.onnx', size: 160219, sha256: '8f7dee8b46d096f052b359375dfba5d983cc4d18c44a783bf548615c472f8dea' },
  { path: 'onnx/model_q4.onnx_data', size: 917120144, sha256: 'f30998e28c71c5374cc7e8b7de8f0f83e981592c0c2d652d2ad4928454dbb496' },
]

const target = join(dirname(fileURLToPath(import.meta.url)), 'models', MODEL)

async function sha256(file) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

async function isIntact(file, { size, sha256: expected }) {
  const info = await stat(file).catch(() => null)
  if (!info || info.size !== size) return false
  return !expected || (await sha256(file)) === expected
}

for (const entry of FILES) {
  const file = join(target, entry.path)
  if (await isIntact(file, entry)) { console.log(`ok       ${entry.path}`); continue }

  console.log(`download ${entry.path} (${(entry.size / 1e6).toFixed(1)} MB)`)
  await mkdir(dirname(file), { recursive: true })
  const res = await fetch(`https://huggingface.co/${MODEL}/resolve/${REVISION}/${entry.path}`)
  if (!res.ok) throw new Error(`${entry.path}: HTTP ${res.status}`)
  const partial = `${file}.partial`
  await pipeline(Readable.fromWeb(res.body), createWriteStream(partial))
  if (!(await isIntact(partial, entry))) {
    await rm(partial, { force: true })
    throw new Error(`${entry.path}: size or checksum does not match the pinned revision`)
  }
  await rename(partial, file)
}

console.log(`Model ready at ${target}`)
