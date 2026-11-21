import { spawn } from 'child_process'
import { writeFile, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const LIBREOFFICE = process.env.LIBREOFFICE_PATH

// In the desktop app the shell converts DOCX files itself (cleaning them first)
// and offers that as a local endpoint; this route then only passes the file on.
async function convertViaDesktop(file: File): Promise<Response> {
  const res = await fetch(process.env.DOCX_CONVERTER_URL!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      Authorization: `Bearer ${process.env.DOCX_CONVERTER_TOKEN ?? ''}`,
    },
    body: await file.arrayBuffer(),
  })
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: undefined }))
    return new Response(JSON.stringify({ error: error ?? 'DOCX conversion failed.' }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    })
  }
  return new Response(await res.arrayBuffer(), {
    headers: {
      'Content-Type': 'application/pdf',
      'X-Docx-Engine': res.headers.get('X-Docx-Engine') ?? '',
      'X-Docx-Removed': res.headers.get('X-Docx-Removed') ?? '',
    },
  })
}

export async function POST(req: Request) {
  if (process.env.DOCX_CONVERTER_URL) {
    const file = (await req.formData()).get('file') as File | null
    if (!file) return new Response(JSON.stringify({ error: 'No file provided' }), { status: 400 })
    return convertViaDesktop(file)
  }

  if (!LIBREOFFICE) {
    return new Response(
      JSON.stringify({ error: 'DOCX conversion is not available. LibreOffice is not configured (set LIBREOFFICE_PATH).' }),
      { status: 501, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const form = await req.formData()
  const file = form.get('file') as File
  if (!file) return new Response(JSON.stringify({ error: 'No file provided' }), { status: 400 })

  const id = randomUUID()
  const inPath = join(tmpdir(), `${id}.docx`)
  const outDir = tmpdir()

  await writeFile(inPath, Buffer.from(await file.arrayBuffer()))

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(LIBREOFFICE, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, inPath])
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`LibreOffice exited with code ${code}`)))
  })

  const pdfPath = join(outDir, `${id}.pdf`)
  const pdfData = await readFile(pdfPath)
  await rm(inPath, { force: true })
  await rm(pdfPath, { force: true })

  return new Response(pdfData, { headers: { 'Content-Type': 'application/pdf' } })
}
