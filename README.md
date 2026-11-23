# LocalRedact

[![Desktop build](https://github.com/christian-klng/localredact/actions/workflows/desktop.yml/badge.svg?branch=main)](https://github.com/christian-klng/localredact/actions/workflows/desktop.yml)

Desktop app for redacting sensitive data in PDF and DOCX files. Everything runs on your own computer: the app makes no connection to the internet, and there is no cloud mode.

LocalRedact is a fork of [EasyRedact](https://github.com/datenlabor-bmz/easy-redact) and is under development. [PLAN.md](PLAN.md) holds the roadmap, the decisions taken so far and what is still open.

## What it does

- **Finds personal data** with a bundled model ([OpenAI Privacy Filter](https://huggingface.co/openai/privacy-filter), Apache-2.0) and with patterns for phone numbers, e-mail addresses, IBANs, dates and identifiers. The model runs on the graphics card where one is usable and on the processor otherwise.
- **Manual redaction**: draw rectangles or select text directly on the page.
- **FOI / IFG mode**: assign the exemption clause of a Freedom of Information law to each redaction. The German IFG is bundled.
- **DOCX**: documents are cleaned first (tracked changes accepted; comments, hidden text and document properties removed) and then converted to PDF, by LibreOffice when it is installed and by a built-in renderer otherwise.
- **Export**: a preview PDF with highlights for review, and a redacted PDF. In the redacted PDF the marked areas are removed from the page (text, the pixels of images, line art), and so is everything else that could repeat them: document properties, embedded metadata, attachments, bookmarks, comments, scripts, page thumbnails and links that name redacted text. The file is then opened again and checked, and the result is shown before it is saved.
- **Invisible text**: text that is in a page but cannot be seen on it (white on white, invisible render mode, tiny) is marked for redaction when a document is opened.
- **Chat assistant** (optional, experimental): a language model running locally suggests redactions and explains them. See `PLAN.md` for the state of this.

## Development

```bash
npm ci
npm run dev            # the web UI alone, at http://localhost:3000
npm test               # tests of the redacted export (Node 24)
```

The desktop app lives in `desktop/`:

```bash
cd desktop
npm ci
npm run fetch:models   # downloads the NER model (about 0.9 GB) into desktop/models
npm run build:server   # builds the bundled server
npm start              # runs the app
npm run pack           # packages it into desktop/dist
```

`npm run smoke` starts the app, checks it and exits. With `LOCALREDACT_SMOKE_DOCX=/path/to/file.docx` it also converts that file, opens the result and waits for the model's findings. The document has to contain at least one person's name that the model detects; the run waits for that finding and fails when it does not appear. It then opens two more documents, switches between them and switches a category off and on, and checks that each document keeps exactly its own findings. It also fails if anything tried to reach another machine.

Configuration is read from environment variables; `.env.example` lists them. The desktop app sets what it needs itself.

All icons are generated from one drawing, `desktop/icons/source.svg` (the "lock-keyhole" icon from [Lucide](https://lucide.dev), ISC licence). After changing it, run `desktop/node_modules/.bin/electron desktop/icons/render-source.js` and then `python3 desktop/icons/make-icons.py` (needs Pillow, and macOS for the `.icns` file), and commit the results.

## How the offline guarantee is enforced

- The app's windows cannot resolve any name but localhost, and every request to another machine is cancelled and recorded (`desktop/network/lockdown.js`).
- The bundled server refuses every connection that does not stay on the computer (`desktop/network/guard.js`).
- The self-test above runs on macOS, Windows and Linux for every change.

## How LocalRedact is checked

Every change reaches `main` through a pull request. A pull request that touches the app (its code, the desktop shell or their dependencies) runs the checks below and is merged only when they pass; one that changes documentation alone does not run the self-test.

- **Self-test on macOS, Windows and Linux.** The packaged app is started on all three systems. It converts a DOCX, opens the result, waits for the bundled model's findings, and then works with several documents at once. The run fails if anything tried to reach another machine or if a finding ended up with the wrong document. The badge at the top shows the most recent run of this check on `main`.
- **Tests of the redacted export.** A test document carries the same name in every place a PDF offers (page text, bookmark, properties, metadata, attachment, comment, link, script, thumbnail, an orphaned object). The tests export it and search the whole decompressed result for what is left.
- **Automated code review, when requested.** Pull requests can be reviewed by [CodeRabbit](https://www.coderabbit.ai/); for this repository a review has to be triggered by hand and does not happen for every pull request. Where it ran, its comments are public on the [pull request](https://github.com/christian-klng/localredact/pulls?q=is%3Apr); several fixes in this repository go back to them.

What this does not replace: LocalRedact has not had an independent security audit, and the automated checks cover a limited set of situations. Whoever publishes a redacted document remains responsible for checking it. `PLAN.md` lists the known gaps.

## Tech stack

- **Electron** shell with a bundled **Next.js 15** / **React 19** server bound to 127.0.0.1
- **MuPDF** — PDF rendering and redacted export (WASM)
- **transformers.js** with **ONNX Runtime** — NER in the window (WebGPU) or in the server process (native)
- **docx-preview** and optionally **LibreOffice** — DOCX to PDF
- **Tailwind CSS v4** + **shadcn/ui**
- **IndexedDB** — local storage of documents, session and chat

## License

AGPL-3.0. This project uses [MuPDF](https://mupdf.com/licensing/), which is licensed under the GNU Affero General Public License. The app icon is derived from a [Lucide](https://lucide.dev) icon (ISC licence).

## Credits

LocalRedact is a fork of [EasyRedact](https://github.com/datenlabor-bmz/easy-redact), built by the [BMZ DataLab](https://www.bmz-digital.global/en/overview-of-initiatives/the-bmz-data-lab/), the data science unit of Germany's Federal Ministry for Economic Cooperation and Development. The development of EasyRedact was funded by the European Union — [NextGenerationEU](https://next-generation-eu.europa.eu).

LocalRedact is an independent project and is not affiliated with or endorsed by the BMZ or the European Union.
