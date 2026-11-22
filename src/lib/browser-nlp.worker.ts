import { pipeline as _pipeline, env, type TokenClassificationPipeline } from '@huggingface/transformers'
import * as Comlink from 'comlink'
import { NER_DTYPE, NER_MODEL, toEntities, type AggregatedEntity, type NerEntity } from '@/lib/ner-entities'

export type { NerEntity }

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

let classifier: TokenClassificationPipeline | null = null

// `navigator.gpu` also exists on machines whose graphics hardware cannot
// actually be used (virtual machines, remote desktops, old drivers), so only an
// adapter that can really be obtained counts.
async function hasUsableGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) return false
  try { return !!(await gpu.requestAdapter()) } catch { return false }
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
  const fileProgress = new Map<string, number>()
  let lastReported = -1
  // The model's compressed format only runs on the graphics card in a browser;
  // without one the caller falls back to the server (see browser-nlp.ts).
  if (!(await hasUsableGpu())) throw new Error('No usable graphics card for the NER model')

  classifier = await (_pipeline as any)('token-classification', NER_MODEL, {
    device: 'webgpu', dtype: NER_DTYPE,
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
