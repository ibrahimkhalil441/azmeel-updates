# Azmeel for Figma: AI files

The AI models and runtime that the Azmeel Figma plugin downloads on first use (background removal and the Clean trace
clean-up). The plugin loads them from https://cdn.jsdelivr.net/gh/ibrahimkhalil441/azmeel-updates@main/figma-ai/ai/.

- onnxruntime-web 1.20.1 (MIT): ort.wasm.min.js, ort-wasm-simd-threaded.mjs / .wasm. See onnxruntime.LICENSE.txt and
  onnxruntime.ThirdPartyNotices.txt.
- U^2-Net small, u2netp.onnx (Apache-2.0). See u2net.LICENSE.txt.
- Real-ESRGAN General x4v3, real_esrgan_general_x4v3.onnx + .data (BSD-3-Clause). See real-esrgan.LICENSE.txt.

Do not rename or move these files: published plugin builds point at these exact paths.
