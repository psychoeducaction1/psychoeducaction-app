import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

// Node's native TypeScript runner does not resolve the application's @/ alias.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const base = resolve(root, specifier.slice(2))
      const path = [base, `${base}.ts`, `${base}.js`, `${base}.mjs`, `${base}/index.ts`]
        .find((candidate) => existsSync(candidate))
      if (path) return nextResolve(pathToFileURL(path).href, context)
    }
    return nextResolve(specifier, context)
  },
})

globalThis.fetch = async () => {
  throw new Error('Unit tests are offline. Mock fetch instead of contacting an external service.')
}
