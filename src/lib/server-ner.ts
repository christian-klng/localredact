// Runs the NER model inside the server process, on the processor. The browser
// can only run this model on a usable graphics card; computers without one
// (many office PCs, virtual machines, remote desktops) use this path instead.
import path from 'node:path'
import { NER_DTYPE, NER_MODEL, toEntities, type AggregatedEntity, type NerEntity } from '@/lib/ner-entities'

type Classifier = (text: string, options: { aggregation_strategy: 'simple' }) => Promise<AggregatedEntity[]>

let loading: Promise<Classifier> | null = null

async function load(): Promise<Classifier> {
  const { pipeline, env } = await import('@huggingface/transformers')
  if (process.env.NER_MODELS === 'local') {
    // The model ships with the app; nothing may be downloaded.
    env.allowRemoteModels = false
    env.allowLocalModels = true
    env.localModelPath = (process.env.NER_MODELS_DIR ?? path.join(process.cwd(), 'public', 'models')) + path.sep
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (pipeline as any)('token-classification', NER_MODEL, { dtype: NER_DTYPE, device: 'cpu' }) as Classifier
}

// One load at a time, kept for the life of the process; a failed load can be retried.
function getClassifier(): Promise<Classifier> {
  loading ??= load().catch(err => { loading = null; throw err })
  return loading
}

export async function analyzeOnServer(pages: { pageIndex: number; text: string }[]): Promise<{ pageIndex: number; entities: NerEntity[] }[]> {
  const classifier = await getClassifier()
  const results = []
  for (const { pageIndex, text } of pages) {
    const output = text.trim() ? await classifier(text, { aggregation_strategy: 'simple' }) : []
    results.push({ pageIndex, entities: toEntities(output, text) })
  }
  return results
}
