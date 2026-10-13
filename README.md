# Pelican Cycling

> **免责声明**
>
> 本项目为恶搞实验，仅供娱乐、学习和技术研究。请仅在自有或已获授权的环境中使用，禁止用于恶意用途、未经授权的会话干预或损害他人权益。模型输出不保证准确、完整或适用于实际业务；使用及修改本项目时，请遵守适用法律和各组件的许可证。

一个认真浪费 AI 的 DeepSeek Harness 恶搞插件：先用用户当前模型做语义二分类，再让真正的 Pelican PRO 模型推理生成它唯一擅长的网页。

**安装前请知悉：** 启用后，每条新输入会额外调用当前模型进行分类，可能增加费用与延迟；匹配请求会由本地 Pelican PRO 生成结果，界面的模型选择不会随之切换。请确保受影响的使用者知悉并授权这种行为。本项目不隶属于 DeepSeek 或 0u0ai，也不代表这些项目的认可。

它没有关键词路由，没有内置网页，没有 HTML 响应缓存，也没有把失败请求换成预制答案。

## 工作方式

1. 拦截原会话第一次模型调用，读取本次最新的人类文本输入。工具结果、辅助模型调用和后续工具循环直接放行。
2. 在独立、临时的对话上下文中，通过 Harness 的 `llm` 服务调用原请求的 **同一个 provider、model 和 reasoningEffort**。模型状态悬浮窗显示“正在判断……”。不复制原会话历史，不给分类器工具，不新建侧栏聊天。
3. 分类器只允许 `0` 或 `1`：只有“制作鹈鹕骑自行车网页”的意图返回 `1`。介绍这个梗、讨论模型、翻译这句话、普通骑车问题均返回 `0`。分类失败会重试；仍无有效标签时返回错误，不靠关键词补判。
4. `0` 原样委托原适配器；`1` 以 `stream: true` 请求本机 `llama-server /completion`，由真实 GGUF 权重重新生成整个网页。分类器读取完整本次输入；已确认的制作意图在本地规范化为模型支持的中文任务提示“生成鹈鹕骑自行车的html”，不传历史。当前 V2 对等义英文输入可能返回不支持，不能直接照抄模型卡的“任意输入”描述。
5. 收到 SSE 文本后立即转成原会话的 `text-delta`，保留模型自带的 Markdown HTML 代码块。生成完成后才去掉外层围栏、验证完整 HTML 并保存预览文件，最后追加预览链接、`block-end → usage → finish`。不改写网页内容；取消或失败会正常中断流，不会替换为固定答案。

重试同一个消息会复用二分类标签，仍会重新运行 Pelican 推理。新的人类消息重新分类。插件卸载和用户取消会中止正在进行的请求。

## 兼容版本

2026-10-13 核对的官方最新发布为 **DeepSeek Harness 0.2.1-alpha.2**，源码提交 `d743267388641bc76f17c45ce8b4c231aed1d32c`。npm 的 `latest` 标签仍指向较旧版本，因此下面明确指定版本。

同时兼容当前稳定版 `0.2.0-rc.2`；已核对桌面版实际内置接口，旧版缺少工作目录服务时使用会话原工作目录。WebUI 与 Desktop 共用宿主模型 waterfall 和消息协议，插件不改前端文件，也不需要浏览器扩展。版本依赖使用 peerDependencies，避免重复加载 `dsh-llm` 导致请求身份识别失效。Harness 仍在快速迭代；升级时需要重新检查这些接口。

## 本地模型：Windows x64

需要 Node.js 22.19+ 或 24+、npm、PowerShell，以及能够下载 GitHub/Hugging Face 文件的网络。默认自动使用可用 GPU；NVIDIA 优先 CUDA，其次 Vulkan，最后回退独立的 CPU 后端。其他显卡尝试 Vulkan。无需 Python 或 Ollama，也无需为本项目安装完整 CUDA Toolkit；已有 CUDA 13 运行库可供 CUDA 后端复用。

在项目目录执行：

```powershell
npm ci
npm run build
powershell -ExecutionPolicy Bypass -File scripts/setup-model.ps1
powershell -ExecutionPolicy Bypass -File scripts/start-model.ps1
npm run verify:model
```

安装脚本只下载到项目 `.runtime/`，校验官方运行时和约 168 MB 的 GGUF SHA-256；不修改系统服务或显卡驱动。启动脚本以隐藏窗口方式运行，监听 `http://127.0.0.1:19140`。

`setup-model.ps1` 和 `start-model.ps1` 支持 `-Backend auto|cuda|vulkan|cpu`，默认 `auto`。GPU 后端会实际探测设备并确认模型层已卸载到 GPU；不可用或初始化失败时自动改用 CPU。端口被占用、文件哈希错误等配置或完整性问题会直接报告。启动记录在 `.runtime/model-process.json`，其中记录实际使用的后端。

手动切换后端时，先停止项目自己的服务，再启动所需后端，例如：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/stop-model.ps1
powershell -ExecutionPolicy Bypass -File scripts/start-model.ps1 -Backend cpu
```

固定使用模型仓库修订 `6981d554c08a3727d960c9dbbd345af887f643e9` 的 `0u0-pelican-pro-v2-Q4_K_M.gguf`。模型卡仍描述旧版 63,617 字节、约 28,472 token 的网页；当前 V2 实测生成 31,436 字节 HTML、14,213 个输出 token。服务器保守保留 32,768 上下文、单 slot、temperature 0，并覆盖 GGUF 中旧的 16,384 上下文元数据。默认最大生成 32,000 token，超时 30 分钟。

CUDA 默认开启全层 GPU、Flash Attention、GPU 后端贪心采样和 Q8 KV 缓存。Vulkan 与 CPU 保留各自可用的默认参数。

本机 CPU 完整推理实测约 278 秒，其他硬件耗时会不同。插件边生成边输出，完整生成结束后才保存预览文件。`artifacts/model-verification/` 是实际推理的验收产物，插件运行时不会读取它。

停止项目启动的模型进程：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/stop-model.ps1
```

如果改用已有 llama-server，请保留启动脚本中的上下文覆盖、单 slot 和贪心采样参数，并修改插件 endpoint。其他操作系统可使用官方 llama.cpp 构建的同版本服务器；本项目附带的自动部署脚本针对 Windows。

## 安装到 Harness

已发布到 npm 后，WebUI 使用包名安装：

```powershell
npx --yes @deepseek-ai/dsh@0.2.1-alpha.2 plugin --profile web add dsh-pelican-router@0.1.2
```

Desktop 需先打开一次以初始化 profile，完全退出后使用其安装目录内置的命令：

```powershell
& 'C:/实际安装目录/resources/runtime/cli/bin/dsh.cmd' plugin --profile desktop add dsh-pelican-router@0.1.2
```

也可从 [GitHub Releases](https://github.com/Gliese-876/dsh-pelican-router/releases) 下载预编译的 `.tgz`，用下面的本地包命令安装。包内已包含编译文件，无需允许安装时构建脚本。

从源码自行打包：

```powershell
npm pack
```

在同一目录安装至所需 profile；这些命令会更新该 profile 的插件配置：

```powershell
npx --yes @deepseek-ai/dsh@0.2.1-alpha.2 plugin --profile web add ./dsh-pelican-router-0.1.2.tgz
```

WebUI 可用 `npx --yes @deepseek-ai/dsh@0.2.1-alpha.2 web` 启动。

Desktop 使用匹配版本的官方桌面客户端：先打开一次以初始化 profile，完全退出，再使用 Desktop 安装目录中 `resources/runtime/cli/bin/dsh.cmd` 自带的命令载体安装。将下面路径替换为实际安装位置：

```powershell
& 'C:/实际安装目录/resources/runtime/cli/bin/dsh.cmd' plugin --profile desktop add (Join-Path (Get-Location) 'dsh-pelican-router-0.1.2.tgz')
```

普通 npm/npx CLI 会拒绝管理保留的 `desktop` profile，因此 Desktop 必须使用其自带命令。安装后重新打开相应客户端。原会话要先配置一个可正常调用的模型；分类器复用 Harness 对它的配置和认证，不单独保存 API key。

插件列表中会出现 `pelican-router`。停用插件即可恢复常规行为；卸载命令为：

```powershell
npx --yes @deepseek-ai/dsh@0.2.1-alpha.2 plugin --profile web remove dsh-pelican-router
& 'C:/实际安装目录/resources/runtime/cli/bin/dsh.cmd' plugin --profile desktop remove dsh-pelican-router
```

## 日常呈现与配置

右下角的小悬浮窗显示当前模型状态与路由信息，可拖动标题栏移动位置，可收起，也可展开完整流程，支持明暗主题。“正在判断……”“已路由至本地 0u0ai Pelican PRO……”“正在推理并流式输出……”等状态明确可见；无关请求显示继续由原模型回答。悬浮窗通过独立的、经过 Harness 认证的 UI 通道读取临时状态，不写入会话消息或工具结果，也不进入模型上下文。插件不修改模型选择器；实际路由以悬浮窗为准。

Harness 不会直接执行聊天 Markdown 中的 HTML。插件会保留可复制的 HTML 代码块；在可写工作区中创建一个新的 `.html` 文件，供客户端内建的沙箱预览器打开。写入遵循当前会话的文件系统与 sandbox 策略；不会覆盖已有文件。`preview: false` 可以只输出代码块。

默认配置在 `cordis.patch.yml`。profile 的覆盖层可按 `id: pelican-router` 覆盖配置：

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `endpoint` | `http://127.0.0.1:19140` | 只接受本机 HTTP 根地址 |
| `classifierMaxTokens` | `4096` | 包含分类模型推理预算；高推理模式可增大 |
| `classifierTimeoutMs` | `120000` | 分类总超时 |
| `classifierAttempts` | `2` | 非法标签或失败时的真实模型重试次数 |
| `generationMaxTokens` | `32000` | 必须足够容纳完整 HTML |
| `generationTimeoutMs` | `1800000` | 本地推理总超时 |
| `decisionCacheSize` | `256` | 内存中的消息分类标签上限 |
| `preview` | `true` | 写入真实输出文件并附预览链接 |

## 验证

```powershell
npm run build
npm test
npm run verify:model
```

单元与集成测试使用真实 Cordis 和 Harness LLM 服务；脚本适配器和 HTTP fixture 只用于测试，不参与插件运行。真实 GGUF 验收单独运行，产出 HTML、生成时间、token 和 SHA-256 记录。自动测试不需要你的模型 API key；实际同模型分类需要 Harness 中已配置的可用模型。

本次验收：TypeScript 编译通过，46 项自动测试通过，包含流程提示不进入模型上下文的检查。RTX 5080 Laptop 的 CUDA 完整推理优化后 23.5 秒（Vulkan 29.5 秒，CPU 278 秒），输出 SHA-256 一致。已安装到 Desktop `0.2.0-rc.2`，使用现有 `DeepSeek-V41-Flash / Max` 实测：鹈鹕网页请求约 28 秒完成，流式输出及原生动画预览正常；无关问题 `2+2` 正常返回 `4`。WebUI 独立界面尚未实测，其适配使用同一套 Host API 与消息协议。

## 许可证与来源

项目代码采用 **AGPL-3.0-only**。模型、推理引擎和 Harness 保留各自许可证，见 `THIRD_PARTY_NOTICES.md`。模型权重与参考源码不打入 npm 插件包。

上游模型卡对其记忆网页的来源作了说明，但这不等同于本项目已核验该网页所有潜在第三方权利。本项目不分发生成网页、模型权重或 GPU 运行库，也不为这些内容另行授予许可。公开部署为服务与发布源码具有不同的合规要求，运营者需按自己的场景评估。

发行包包含 TypeScript 首选源码和构建配置。修改后通过网络向用户提供本项目服务时，应按 AGPL 第 13 条提供对应源码的获取方式。

- [DeepSeek Harness 官方源码](https://github.com/deepseek-ai/deepseek-harness)
- [Harness 插件发行与安装说明](https://deepseek-harness.github.io/deepseek-harness/user/develop/basic/publish.html)
- [Pelican PRO GGUF 模型](https://huggingface.co/0v0ai/0u0-pelican-pro-0.2B-GGUF)
- [llama.cpp 官方服务器](https://github.com/ggml-org/llama.cpp/tree/master/tools/server)
