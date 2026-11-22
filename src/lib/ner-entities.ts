// Shared by the in-browser worker and the server-side fallback: the NER model
// and how its output is turned into located text spans.

export interface NerEntity {
  text: string
  type: string
  score: number
  startIndex: number
  endIndex: number
}

// A PII detector rather than a general NER model: it labels private persons,
// addresses, e-mail addresses, phone numbers, dates, account numbers, URLs and
// secrets. Licensed Apache-2.0.
export const NER_MODEL = 'openai/privacy-filter'
export const NER_DTYPE = 'q4'
const MIN_SCORE = 0.5

export interface AggregatedEntity { entity_group: string; word: string; score: number }

// The pipeline returns each span as text only. Locate it in the page, moving a
// cursor forward so repeated names map to successive occurrences.
export function toEntities(output: AggregatedEntity[], originalText: string): NerEntity[] {
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
