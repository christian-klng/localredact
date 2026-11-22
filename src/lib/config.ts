export type LocalAi = 'ner-browser' | 'llm' | 'ner'

declare global {
  interface Window { __ER_CFG__?: { localAi: LocalAi; nerModels?: 'local' | 'remote' } }
}

const fromWindow = () => typeof window !== 'undefined' ? window.__ER_CFG__ : undefined

export const localAi: LocalAi = fromWindow()?.localAi ?? (process.env.LOCAL_AI as LocalAi) ?? 'ner-browser'
// 'local' means the NER model and its runtime are served by the app itself and
// nothing is downloaded (desktop build); 'remote' fetches them on first use.
export const nerModelsLocal = (fromWindow()?.nerModels ?? process.env.NER_MODELS) === 'local'
