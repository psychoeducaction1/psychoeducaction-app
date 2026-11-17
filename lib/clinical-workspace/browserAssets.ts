/** Public, same-origin files required by the browser transcription engine. */
export const BROWSER_TRANSCRIPTION_ASSETS = [
  'onnx-community/whisper-base/onnx/encoder_model_quantized.onnx',
  'onnx-community/whisper-base/onnx/decoder_model_merged_quantized.onnx',
  'onnx-runtime/ort-wasm-simd-threaded.asyncify.wasm',
] as const
