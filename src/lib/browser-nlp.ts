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

export async function loadBrowserNlpModel(onProgress: (e: ProgressEvent) => void) {
  await getWorker().loadModel(Comlink.proxy(onProgress), {
    local: nerModelsLocal,
    basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  })
}

export async function analyzePagesInBrowser(
  pages: { pageIndex: number; text: string }[],
  onPageDone?: (pageIndex: number, suggestions: RedactionSuggestion[]) => void,
): Promise<RedactionSuggestion[]> {
  const all: RedactionSuggestion[] = []
  await getWorker().analyzePages(
    pages,
    Comlink.proxy((pageIndex: number, entities: NerEntity[]) => {
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
    }),
  )
  return all
}
