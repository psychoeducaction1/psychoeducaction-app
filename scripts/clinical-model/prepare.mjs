import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Public model files only. They are downloaded at build time, never committed
// with clinical data or loaded through a clinical API endpoint.
const revision = '27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c'
const files = {
  'added_tokens.json': '9715fd2243b6f06a5858b5e32950d2853f73dd5bc201aafcf76f5082a2d8acd1',
  'config.json': 'f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b',
  'generation_config.json': '61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0',
  'merges.txt': '2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6',
  'normalizer.json': 'bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd',
  'preprocessor_config.json': 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d',
  'special_tokens_map.json': 'e67ae3a0aaa99abcd9f187138e12db1f65c16a14761c50ef10eef2c174a7a691',
  'tokenizer_config.json': '2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573',
  'tokenizer.json': '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566',
  'vocab.json': '50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a',
  'onnx/encoder_model_quantized.onnx': '5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46',
  'onnx/decoder_model_merged_quantized.onnx': 'fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b',
}
const wasm = {
  'ort-wasm-simd-threaded.asyncify.mjs': '0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611',
  'ort-wasm-simd-threaded.asyncify.wasm': '49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082',
}
const root = fileURLToPath(new URL('../../', import.meta.url))
const target = join(root, 'public', 'clinical-model')
const enabled = process.argv.includes('--force') || process.env.PEA_REAL_BROWSER_TRANSCRIPTION_ENABLED === 'true'
  || process.env.PEA_CONTROLLED_MERGE === 'true'

async function digest(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
async function ensure(path, expected, source) {
  try { if (await digest(path) === expected) return } catch { /* file is absent */ }
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.download-${process.pid}`
  try {
    const response = await fetch(source, { redirect: 'follow' })
    if (!response.ok || !response.body) throw Error(`Téléchargement du modèle : HTTP ${response.status}`)
    await writeFile(temporary, Buffer.from(await response.arrayBuffer()))
    if (await digest(temporary) !== expected) throw Error('Empreinte du modèle différente de la version attendue.')
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}

if (enabled) {
  for (const [name, hash] of Object.entries(files)) {
    const url = `https://huggingface.co/onnx-community/whisper-base/resolve/${revision}/${name}`
    await ensure(join(target, 'onnx-community', 'whisper-base', name), hash, url)
  }
  for (const [name, hash] of Object.entries(wasm)) {
    const source = join(root, 'node_modules', 'onnxruntime-web', 'dist', name)
    if (await digest(source) !== hash) throw Error('Moteur WASM différent de la version attendue.')
    const destination = join(target, 'onnx-runtime', name)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(source, destination)
  }
  // No personal or clinical data is written to the public model directory.
  await import('./prepare-ner.mjs')
  console.log('Modèles de transcription et de filtrage des noms prêts.')
}
