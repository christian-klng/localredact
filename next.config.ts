import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// A build that ships the NER model and its runtime itself (the desktop app)
// has no reason to talk to anyone, so its policy names no outside host at all.
const offline = process.env.NER_MODELS === 'local'

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Next.js inline scripts + MuPDF/ONNX WASM require unsafe-eval; jsdelivr hosts ONNX Runtime WASM workers
      `script-src 'self' 'unsafe-eval' 'unsafe-inline'${offline ? '' : ' https://cdn.jsdelivr.net'}`,
      "style-src 'self' 'unsafe-inline'",
      // PDF rendering uses blob: and data: URLs
      "img-src 'self' data: blob:",
      "font-src 'self'",
      // Web workers (MuPDF) loaded via blob:
      "worker-src 'self' blob:",
      // API routes + HuggingFace model downloads + ONNX Runtime WASM for browser NLP
      offline
        ? "connect-src 'self' blob: data:"
        : "connect-src 'self' https://huggingface.co https://cdn-lfs.hf.co https://*.hf.co https://*.xethub.hf.co https://cdn.jsdelivr.net",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
]

const basePath = process.env.BASE_PATH || ''

const nextConfig: NextConfig = {
  output: 'standalone',
  // The NER model also runs on the server; its runtime is a native module that
  // must be loaded from node_modules, not bundled.
  serverExternalPackages: ['@huggingface/transformers', 'onnxruntime-node'],
  // File tracing misses the native runtime: it is an optional import of the
  // model library and loads its binary by a computed path. Its code is listed
  // here, with the binaries of this platform only.
  outputFileTracingIncludes: {
    '/api/ner': [
      './node_modules/onnxruntime-node/package.json',
      './node_modules/onnxruntime-node/dist/**',
      `./node_modules/onnxruntime-node/bin/napi-v*/${process.platform}/${process.arch}/**`,
    ],
  },
  ...(basePath ? { basePath, assetPrefix: basePath, trailingSlash: true } : {}),
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
  webpack(config, { isServer }) {
    if (!isServer) {
      // mupdf WASM has Node.js conditional imports that need to be ignored in browser
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        module: false,
      }
      config.resolve.alias = {
        ...config.resolve.alias,
        'sharp$': false,
        'onnxruntime-node$': false,
      }
      // Handle node: protocol imports (e.g. node:fs, node:path)
      config.plugins = config.plugins ?? []
      config.plugins.push(
        new (require('webpack').NormalModuleReplacementPlugin)(
          /^node:/,
          (resource: any) => {
            resource.request = resource.request.replace(/^node:/, '')
          }
        )
      )
    }
    return config
  },
}

export default withNextIntl(nextConfig)
