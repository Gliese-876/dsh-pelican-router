# Third-party notices

Checked on 2026-10-13 against `package-lock.json`, installed package license files, and the pinned upstream sources below.

Copyright (c) 2026 Pelican Cycling contributors. The original plugin source is licensed under **AGPL-3.0-only**; see [LICENSE](LICENSE). Third-party components retain their own licenses. No DeepSeek Harness implementation source, model weights, runtime binaries, or precomputed model output is embedded in the plugin.

## npm dependencies and build tools

All packages below are installed separately by npm or supplied by the Harness host. Their code is not bundled into the plugin's compiled JavaScript. Their original license and copyright notices remain in the installed packages and must accompany redistribution of those packages.

| Component | Locked version | Original license | Source | Distribution in plugin tarball |
| --- | --- | --- | --- | --- |
| `@deepseek-ai/cordis` | 4.0.5-alpha.1 | MIT | [Harness] | No; host peer / build dependency |
| `@deepseek-ai/cosmokit` | 1.8.6-alpha.1 | MIT | [Harness] | No; npm runtime dependency |
| `@deepseek-ai/dsh-agent` | 0.2.1-alpha.2 | MIT | [Harness] | No; host peer / build dependency |
| `@deepseek-ai/dsh-brand` | 0.2.1-alpha.2 | MIT | [Harness] | No; transitive host / build dependency |
| `@deepseek-ai/dsh-client-connection` | 0.2.1-alpha.2 | MIT | [Harness] | No; host peer / build dependency |
| `@deepseek-ai/dsh-credentials` | 0.2.1-alpha.2 | MIT | [Harness] | No; transitive host / build dependency |
| `@deepseek-ai/dsh-fs` | 0.2.1-alpha.2 | MIT | [Harness] | No; host peer / build dependency |
| `@deepseek-ai/dsh-llm` | 0.2.1-alpha.2 | MIT | [Harness] | No; host peer / build dependency |
| `@deepseek-ai/dsh-sandbox` | 0.2.1-alpha.2 | MIT | [Harness] | No; transitive host / build dependency |
| `@deepseek-ai/dsh-sandbox-policy` | 0.2.1-alpha.2 | MIT | [Harness] | No; host peer / build dependency |
| `@deepseek-ai/dsh-scope` | 0.2.1-alpha.2 | MIT | [Harness] | No; transitive host / build dependency |
| `@deepseek-ai/dsh-session` | 0.2.1-alpha.2 | MIT | [Harness] | No; transitive host / build dependency |
| `@deepseek-ai/dsh-session-projection` | 0.2.1-alpha.2 | MIT | [Harness] | No; transitive host / build dependency |
| `@deepseek-ai/dsh-system-prompt` | 0.2.1-alpha.2 | MIT | [Harness] | No; transitive host / build dependency |
| `@deepseek-ai/dsh-timeout` | 0.2.1-alpha.2 | MIT | [Harness] | No; transitive host / build dependency |
| `@deepseek-ai/dsh-typert-protocol` | 0.2.1-alpha.2 | MIT | [Harness] | No; transitive host / build dependency |
| `@deepseek-ai/dsh-util-crypto` | 0.2.1-alpha.2 | MIT | [Harness] | No; transitive host / build dependency |
| `@deepseek-ai/dsh-util-values` | 0.2.1-alpha.2 | MIT | [Harness] | No; transitive host / build dependency |
| `@deepseek-ai/dsh-working-directory` | 0.2.1-alpha.2 | MIT | [Harness] | No; host peer / build dependency |
| `@deepseek-ai/schemastery` | 3.18.5-alpha.1 | MIT | [Harness] | No; npm runtime dependency |
| `@standard-schema/spec` | 1.1.0 | MIT | [Standard Schema] | No; npm runtime dependency |
| `@types/node` | 24.19.2 | MIT | [DefinitelyTyped] | No; build types |
| `typescript` | 6.0.3 | Apache-2.0 | [TypeScript] | No; build tool |
| `undici-types` | 7.24.6 | MIT | [Undici] | No; build types |
| `zod` | 4.6.7 | MIT | [Zod] | No; transitive host / build dependency |

The separate DeepSeek Harness reference checkout is also MIT-licensed and is excluded from the plugin tarball.

## Separately downloaded local model and runtime

| Component | Pinned version / revision | Original license | Source | Distribution in plugin tarball |
| --- | --- | --- | --- | --- |
| 0u0ai Pelican PRO GGUF, `0u0-pelican-pro-v2-Q4_K_M.gguf` | `6981d554c08a3727d960c9dbbd345af887f643e9` | Apache-2.0, as declared by the author in the model card | [Pinned model card] | No; downloaded to ignored `.runtime/` |
| llama.cpp CUDA, Vulkan, and CPU server builds | v0.6.0 / b11429 | MIT for llama.cpp; backend libraries retain their own licenses | [Pinned llama.cpp license]; [Pinned llama.cpp release] | No; downloaded to ignored `.runtime/` |
| LLVM OpenMP, included in the checked Windows CPU and Vulkan runtime archives | Version supplied by llama.cpp b11429 | Apache-2.0 WITH LLVM-exception | [LLVM license]; archives include `LICENSE-LLVM-OpenMP` | No; retained with the separately downloaded runtime |

The checked Windows Vulkan archive is `llama-b11429-bin-win-vulkan-x64.zip`. It includes `ggml-vulkan.dll` and `LICENSE-LLVM-OpenMP`. The Vulkan loader and GPU driver are supplied by the user's system. The [Khronos Vulkan Loader] is primarily Apache-2.0, with more permissive exceptions identified in its source; GPU drivers retain their vendor's terms.

The plugin sends ordinary HTTP JSON inference requests to an independent `llama-server` process. Runtime components retain their original licenses and are excluded from the plugin tarball.

The independent server's CUDA Runtime and cuBLAS libraries are subject to the proprietary [NVIDIA SDK EULA and CUDA Supplement](https://docs.nvidia.com/cuda/archive/13.1.1/eula/index.html). Setup reuses an existing installation (this machine: CUDA SDK 13.1.1) or downloads the standalone runtime when needed; these libraries remain outside the npm package.

The model card attributes its memorized HTML to output from GPT-6 Astra. HTML is generated by model inference at runtime and is not shipped as plugin source. The plugin's AGPL declaration does not relicense the model weights, runtime, or generated HTML.

## Compatibility basis

The original plugin source and checked npm dependency licenses have no identified incompatibility with AGPLv3. GNU's license directory identifies [MIT / Expat](https://www.gnu.org/licenses/license-list.en.html#Expat) and [Apache-2.0](https://www.gnu.org/licenses/license-list.en.html#apache2) as GPL-compatible, and its [compatibility guidance](https://www.gnu.org/licenses/gpl-faq.en.html#AllCompatibility) applies GPLv3 compatibility to AGPLv3 as well. Original attribution and license-preservation requirements still apply to their respective components.

The complete project license was obtained unchanged from [GNU's official AGPLv3 text](https://www.gnu.org/licenses/agpl-3.0.txt).

[Harness]: https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE
[Standard Schema]: https://github.com/standard-schema/standard-schema/blob/main/LICENSE
[DefinitelyTyped]: https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/LICENSE
[TypeScript]: https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt
[Undici]: https://github.com/nodejs/undici/blob/main/LICENSE
[Zod]: https://github.com/colinhacks/zod/blob/main/LICENSE
[Pinned model card]: https://huggingface.co/0v0ai/0u0-pelican-pro-0.2B-GGUF/blob/6981d554c08a3727d960c9dbbd345af887f643e9/README.md
[Pinned llama.cpp license]: https://github.com/ggml-org/llama.cpp/blob/b11429/LICENSE
[Pinned llama.cpp release]: https://github.com/ggml-org/llama.cpp/releases/tag/b11429
[LLVM license]: https://llvm.org/LICENSE.txt
[Khronos Vulkan Loader]: https://github.com/KhronosGroup/Vulkan-Loader/blob/main/LICENSE.txt
