import { pipeline as _pipeline, env, type TokenClassificationPipeline } from '@huggingface/transformers'
import * as Comlink from 'comlink'

export interface NerEntity {
  text: string
  type: string
  score: number
  startIndex: number
  endIndex: number
}

export type ProgressEvent =
  | { status: 'initiate' | 'download' | 'done'; file: string }
  | { status: 'progress'; file: string; progress: number }
  | { status: 'ready' }

// Where the model and the ONNX runtime come from. With `local` set, nothing is
// fetched from the internet: both are served by the app itself.
export interface ModelSource {
  local: boolean
  basePath: string
}

// A PII detector rather than a general NER model: it labels private persons,
// addresses, e-mail addresses, phone numbers, dates, account numbers, URLs and
// secrets. Licensed Apache-2.0.
const MODEL = 'openai/privacy-filter'
const MIN_SCORE = 0.5

interface AggregatedEntity { entity_group: string; word: string; score: number }

let classifier: TokenClassificationPipeline | null = null

// The pipeline returns each span as text only. Locate it in the page, moving a
// cursor forward so repeated names map to successive occurrences.
function toEntities(output: AggregatedEntity[], originalText: string): NerEntity[] {
  const entities: NerEntity[] = []
  let cursor = 0
  for (const span of output) {
    if (span.score < MIN_SCORE) continue
    const text = span.word.trim().replace(/[,;:.]+$/, '').trim()
    if (text.length < 2) continue
    let startIndex = originalText.indexOf(text, cursor)
    if (startIndex === -1) startIndex = originalText.indexOf(text)
    if (startIndex !== -1) cursor = startIndex + text.length
    entities.push({
      text,
      type: span.entity_group,
      score: span.score,
      startIndex,
      endIndex: startIndex === -1 ? -1 : startIndex + text.length,
    })
  }
  return entities
}

async function loadModel(onProgress: (e: ProgressEvent) => void, source?: ModelSource) {
  if (classifier) { onProgress({ status: 'ready' }); return }
  if (source?.local) {
    env.allowRemoteModels = false
    env.allowLocalModels = true
    env.localModelPath = `${source.basePath}/models/`
    // The files are already on this machine; a second copy in the browser cache
    // would only double the disk usage.
    env.useBrowserCache = false
    if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = `${source.basePath}/ort/`
  }
  const device = (navigator as Navigator & { gpu?: unknown }).gpu ? 'webgpu' : 'wasm'
  const fileProgress = new Map<string, number>()
  let lastReported = -1
  classifier = await (_pipeline as any)('token-classification', MODEL, {
    device, dtype: 'q4',
    progress_callback: (e: any) => {
      if (e.status === 'progress' && e.file) {
        fileProgress.set(e.file, e.progress ?? 0)
        const vals = [...fileProgress.values()]
        const agg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
        if (agg > lastReported) { lastReported = agg; onProgress({ status: 'progress', file: e.file, progress: agg }) }
      } else if (e.status === 'initiate' && e.file) {
        fileProgress.set(e.file, 0)
        onProgress(e)
      } else {
        onProgress(e)
      }
    },
  }) as TokenClassificationPipeline
  onProgress({ status: 'ready' })
}

async function analyzePages(
  pages: { pageIndex: number; text: string }[],
  onPageDone: (pageIndex: number, entities: NerEntity[]) => void,
) {
  if (!classifier) throw new Error('Model not loaded')
  for (const { pageIndex, text } of pages) {
    if (!text.trim()) { onPageDone(pageIndex, []); continue }
    const output = await (classifier as any)(text, { aggregation_strategy: 'simple' }) as AggregatedEntity[]
    onPageDone(pageIndex, toEntities(output, text))
  }
}

Comlink.expose({ loadModel, analyzePages })
