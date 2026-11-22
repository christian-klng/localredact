import { analyzeOnServer } from '@/lib/server-ner'

export const runtime = 'nodejs'

interface NerRequest { pages?: Array<{ pageIndex: number; text: string }> }

// Server-side NER for clients that cannot run the model themselves. An empty
// page list only loads the model, which lets the client show it as ready.
export async function POST(req: Request) {
  const { pages = [] }: NerRequest = await req.json()
  try {
    return Response.json({ pages: await analyzeOnServer(pages) })
  } catch (err) {
    console.error('[ner] model could not be used on the server', err)
    return Response.json({ error: 'The NER model could not be loaded on the server.' }, { status: 501 })
  }
}
