import { OpenAI } from 'openai'

// The assistant only ever talks to a language model running locally, through
// an OpenAI-compatible API (llama.cpp, Ollama, vLLM, ...).
export const modelLocal = () => process.env.LOCAL_LLM_MODEL ?? 'llama3.3:latest'

export function getClient() {
  return {
    client: new OpenAI({
      baseURL: process.env.LOCAL_LLM_API_BASE ?? 'http://localhost:11434/v1',
      apiKey: process.env.LOCAL_LLM_API_KEY ?? 'ollama',
    }),
    model: modelLocal(),
  }
}
