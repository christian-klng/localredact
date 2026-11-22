import * as Comlink from 'comlink'
import type { Remote } from 'comlink'
import type { ModelSource, NerEntity, ProgressEvent } from './browser-nlp.worker'
import { nerModelsLocal } from '@/lib/config'
import type { RedactionSuggestion } from '@/types'

export type { ProgressEvent }

export type ModelStatus = 'idle' | 'downloading' | 'loading' | 'ready' | 'error'

interface WorkerApi {
  loadModel(onProgress: (e: ProgressEvent) => void, source?: ModelSource): Promise<void>
  analyzePages(
    pages: { pageIndex: number; text: string }[],
    onPageDone: (pageIndex: number, entities: NerEntity[]) => void,
  ): Promise<void>
}

// The model's labels are mapped onto the categories the analysis panel already
// offers, so its toggles keep working: persons and addresses use the two NER
// categories, everything else joins the matching pattern category.
const CATEGORY: Record<string, { reason: string; group: string; confidence: 'high' | 'low' }> = {
  private_person: { reason: 'Erkannte Entität: PER', group: 'Personen', confidence: 'high' },
  private_address: { reason: 'Erkannte Entität: LOC', group: 'Adressen', confidence: 'high' },
  private_email: { reason: 'Pattern: email', group: 'E-Mail-Adressen', confidence: 'high' },
  private_phone: { reason: 'Pattern: phone', group: 'Telefonnummern', confidence: 'high' },
  private_date: { reason: 'Pattern: date', group: 'Datumsangaben', confidence: 'low' },
  account_number: { reason: 'Pattern: id', group: 'Kennungen', confidence: 'low' },
  private_url: { reason: 'Pattern: id', group: 'Kennungen', confidence: 'low' },
  secret: { reason: 'Pattern: id', group: 'Kennungen', confidence: 'high' },
}
const OTHER = { reason: 'Pattern: id', group: 'Kennungen', confidence: 'low' as const }

let worker: Remote<WorkerApi> | null = null

function getWorker(): Remote<WorkerApi> {
  if (!worker) {
    const raw = new Worker(new URL('./browser-nlp.worker', import.meta.url), { type: 'module' })
    worker = Comlink.wrap<WorkerApi>(raw)
  }
  return worker
}

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

// Where the model runs: in this window on the graphics card, or - when that is
// not possible - in the server process on the processor.
let runsOnServer = false

async function analyzeOnServer(pages: { pageIndex: number; text: string }[]): Promise<{ pageIndex: number; entities: NerEntity[] }[]> {
  const res = await fetch(`${basePath}/api/ner`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pages }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `NER request failed (${res.status})`)
  return (await res.json()).pages
}

export async function loadBrowserNlpModel(onProgress: (e: ProgressEvent) => void) {
  try {
    await getWorker().loadModel(Comlink.proxy(onProgress), { local: nerModelsLocal, basePath })
    runsOnServer = false
  } catch (err) {
    console.warn('NER model cannot run in this window, using the server instead:', err)
    await analyzeOnServer([]) // loads the model there
    runsOnServer = true
    onProgress({ status: 'ready' })
  }
}

export async function analyzePagesInBrowser(
  pages: { pageIndex: number; text: string }[],
  onPageDone?: (pageIndex: number, suggestions: RedactionSuggestion[]) => void,
): Promise<RedactionSuggestion[]> {
  const all: RedactionSuggestion[] = []
  const collect = (pageIndex: number, entities: NerEntity[]) => {
    const suggestions = entities.map(e => {
      const category = CATEGORY[e.type] ?? OTHER
      return {
        text: e.text,
        pageIndex,
        confidence: category.confidence,
        personGroup: category.group,
        reason: category.reason,
      }
    })
    all.push(...suggestions)
    onPageDone?.(pageIndex, suggestions)
  }

  if (runsOnServer) {
    // One page per request, so progress is reported as it happens.
    for (const page of pages) {
      const [result] = await analyzeOnServer([page])
      collect(page.pageIndex, result?.entities ?? [])
    }
  } else {
    await getWorker().analyzePages(pages, Comlink.proxy(collect))
  }
  return all
}
