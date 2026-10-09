<div align="center">
  <img src="src-tauri/icons/icon.png" alt="ClaudeChat 图标" width="128" height="128" />
  <h1>ClaudeChat</h1>
  <p><strong>轻量、可控、低门槛的 Claude 风格桌面对话客户端</strong></p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" /></a>
</div>

**ClaudeChat 的目标，是做一个轻量、可控、低门槛的 Claude 风格桌面对话客户端。**

一方面保留对 Anthropic 官方 API 的支持，另一方面重点支持自定义 `Base URL` 和第三方中转站 API。本项目聚焦日常对话、多轮上下文、图片和文档输入、联网搜索。

## 下载并使用

**Windows 用户：[下载 ClaudeChat v0.1.4 安装程序（.exe）](https://github.com/RuanzeyuShao/ClaudeChat/raw/refs/heads/v0.1.4/installers/v0.1.4/ClaudeChat_0.1.4_x64-setup.exe)**

v0.1.4 的源码、Windows x64 安装包与校验文件已提交到 [v0.1.4 分支](https://github.com/RuanzeyuShao/ClaudeChat/tree/v0.1.4)，安装包目录为 [installers/v0.1.4](https://github.com/RuanzeyuShao/ClaudeChat/tree/v0.1.4/installers/v0.1.4)。[SHA-256 校验文件](https://github.com/RuanzeyuShao/ClaudeChat/blob/v0.1.4/installers/v0.1.4/SHA256SUMS.txt)和[修改／测试报告](https://github.com/RuanzeyuShao/ClaudeChat/blob/v0.1.4/docs/v0.1.4-test-report.md)一并提供。此次采用版本分支交付，右侧 Releases 仍显示已有 v0.1.3 Release；v0.1.4 请使用上面的下载入口。

从源码运行 v0.1.4 时，先切换到 `v0.1.4` 分支，再执行 `npm ci`、`npm run tauri:dev`。更新安装前请先退出正在运行的 ClaudeChat。

下载后双击安装，启动 ClaudeChat。首次使用时打开「设置」，填写 API Key；使用第三方兼容服务时，再填写该服务提供的 Base URL 和模型 ID。点击「测试连接」，成功后即可开始对话。无需安装 Node.js、Rust，也无需自行编译。

如果直达链接不可用，可打开 [v0.1.4 安装包目录](https://github.com/RuanzeyuShao/ClaudeChat/tree/v0.1.4/installers/v0.1.4)，点击 EXE 后选择下载。旧版安装包仍可从 [v0.1.3 Release](https://github.com/RuanzeyuShao/ClaudeChat/releases/tag/v0.1.3) 和 [v0.1.2 Release](https://github.com/RuanzeyuShao/ClaudeChat/releases/tag/v0.1.2) 获取。

> 使用本客户端需要可用的 Provider API Key（Anthropic、OpenAI、DeepSeek、Kimi/Moonshot、GLM/Zhipu 或兼容服务）。第三方服务支持的模型、搜索能力及费用由相应服务决定。

## 当前功能

### v0.1.4（版本分支）

- 同一会话切换 Provider、API Profile 和模型；保留历史、附件、对话树及原始 Usage，下一轮使用新配置。
- 选择模型仅收起模型列表，配置面板继续编辑，模型／思考／搜索统一应用；设置中的 API 配置使用一致交互。
- 用量 Dashboard 响应式布局、关闭及 Esc 返回，保留统计筛选和聊天阅读位置。
- 来源去重与折叠、Composer 控件字号和分隔优化；向上阅读暂停跟随，新回答在输入框上方提示，点击平滑返回。

查看 [v0.1.4 源码与完整说明](https://github.com/RuanzeyuShao/ClaudeChat/tree/v0.1.4)。

### v0.1.3（main 分支源码）

API 管理采用独立的「我的 API」列表与编辑区，按照「服务 → 连接 → 默认模型」填写，可读取服务模型列表或手动输入。名称可自动生成；密钥和模型未填全时可以先保存草稿，补齐后再启用。「保存配置」不会切换其他连接，「保存并启用」会用于当前聊天。编辑正在使用的配置会同步当前连接。高级参数和单价默认收起，Prompt 预设及通用偏好分为单独页签。

编辑时留空 API Key 会保留原密钥；复制配置不复制密钥；切换配置或关闭编辑区前会提示未保存内容。从 Chat 服务的管理入口打开时直接选中相应配置，旧版全局连接可导入。配置写入、删除及关联清理使用 SQLite 事务，数据库保存失败时尝试恢复之前的系统密钥。删除当前 API 会停用连接，同时保留全部聊天和历史用量。此调整沿用现有数据表，版本仍为 0.1.3。

聊天服务分组支持折叠，折叠状态在本机记忆；输入框服务按钮可重新展开当前服务。新增 Grok Chat，支持自定义 Base URL、API Key、模型发现、流式聊天、图片和 Usage，继续使用统一 Adapter。Grok 当前走 Chat Completions，联网搜索使用 SearXNG；未配置搜索地址时默认关闭搜索，不将原生搜索标成已支持。协议参考 [xAI Chat Completions](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions)。版本仍为 0.1.3。

界面新增 Chat Provider Selector：左侧统一显示 Claude Chat、GPT Chat、Kimi Chat、DeepSeek Chat、GLM Chat；点击快速切换并在右侧弹出配置面板。面板提供 API Profile、API 模型列表与筛选、自定义模型、独立搜索模型、思考滑块、联网模式、搜索地址和能力标签。配置按 Chat 服务记忆，底层 Provider Adapter 不变，版本继续为 0.1.3。

v0.1.3 继续使用 Vue 3 + TypeScript + Tauri 2 + Rust + SQLite，保持纯对话定位。上方可下载 Releases 中的 v0.1.3 安装包，也可从当前源码构建。

- **对话树与回答版本**：历史用户消息可编辑并重发；助手消息可重新生成或继续生成。每次操作新增节点，原消息与后续分支完整保留；使用 `1/3`、`2/3` 切换同一父节点下的版本。“对话树”可查看全部节点、恢复任意节点上下文，并引用其他分支的消息。导出当前选择的分支。
- **Prompt / Persona**：设置中保存、编辑、删除预设，可独立选择是否绑定 System Prompt、模型、Thinking、搜索模式和 API Profile；聊天顶部可直接应用。
- **Profile 能力检测**：“测试当前连接”检查连接、Streaming、Thinking、Vision、Tool、Search 和服务返回的上下文长度。仅以响应证据标注已验证；Vision 接受图片请求时标注“请求已接受”，并不等于图像语义能力已验证。服务未返回上下文长度则显示未知；请求被拒绝与未知状态分开显示。检测会发起少量实际请求并产生服务商费用，检测用量不计入聊天统计。
- **历史引用**：引用整条消息或该消息中的选中文字；输入框显示待引用内容，发送后保存来源 ID 和文字快照，可点击返回来源节点。
- **会话管理**：置顶、文件夹和多标签，支持组合筛选；选定文件夹或标签后可统一改名或移除分类。
- **搜索来源**：显示检索状态、服务返回的关键词、展开的来源卡片，以及正文编号和 Provider 原始引用标识。重新搜索创建新版本。Provider 未返回的关键词和来源不会补造。
- **统一 Provider Adapter**：Anthropic Messages、OpenAI Chat Completions、OpenAI Compatible、DeepSeek、Kimi/Moonshot、GLM/Zhipu。用户输入 Base URL、API Key、模型；支持完整 endpoint、自定义路径和模型，不绑定官方地址或固定模型清单。Provider 分别配置认证、Thinking、内置搜索、流式字段、Vision 和 Usage；保留服务返回的 reasoning_content 以支持后续对话。
- **模型附加参数**：可填写 JSON 覆盖模型特定 Thinking / effort 参数；值为 `null` 可移除默认字段。例如需要 adaptive Thinking 时可设置 `{"thinking":{"type":"adaptive"},"output_config":{"effort":"medium"}}`。这允许适配不同模型版本，而无需在代码中写死模型名。客户端保护模型、消息、工具和流式开关。

内置搜索可用于支持该接口的 Anthropic、OpenAI、Kimi 或 GLM 模型；Kimi 的 `$web_search` 会在最多 5 轮内完成工具往返。DeepSeek 和通用兼容服务可使用 SearXNG。能力取决于实际模型及 API 网关。客户端不会执行任意函数、终端命令或自动修改文件。

#### 数据升级与验证

启动时先沿用既有初始化和 v2 迁移，再执行事务化的 **v3 增量迁移**：新增 `message_nodes`、`conversation_tree`，按旧消息的 `created_at,rowid` 建立线性父子关系，并通过 `PRAGMA user_version=3` 记录版本。预设、分类、模型附加参数和能力结果存入已有 settings 表的 `v3:` 命名空间。不会删除或重建数据库、旧消息、附件、Profile、价格、Usage 或用户配置；API Key 仍在原系统凭据位置。

新回答、搜索元数据、Usage 和回答节点的对应关系在同一事务中提交。旧版 Usage 与回答数量一致时建立历史对应关系；若旧版重新生成曾留下多余 Usage，则保留全部统计且不猜测对应节点。

```powershell
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri:dev
npm run tauri:build
```

回归测试覆盖旧数据库升级及重复启动、迁移失败回滚、编辑和再生成保留分支、附件保留、跨会话节点校验、回答与 Usage 原子提交、UTF-8/CRLF 分片、API 流错误、Kimi 搜索工具往返和基于响应证据的能力检测。测试使用内存数据库和本地模拟服务，不读取用户数据库或真实 API Key。

Provider 参考：[OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning)、[DeepSeek thinking](https://api-docs.deepseek.com/guides/thinking_mode/)、[Kimi thinking](https://platform.kimi.ai/docs/guide/use-thinking-models)、[Kimi web search](https://platform.kimi.ai/docs/guide/use-web-search)、[GLM 对话补全](https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8)。

### v0.1.2（源码）

- 代码附件预览随 Light/Dark 主题切换语法色彩和底色，并占满右侧预览区域；输入框附件使用主题强调色图标。侧栏、聊天区和预览区支持拖动分隔线调整宽度；滚动条跟随主题。
- 对话中的数学公式使用与页面样式一致的 KaTeX 版本渲染，修复分式、上下标错位。
- 代码附件支持 Python、C/C++、Java、JavaScript、TypeScript、Vue、Rust、Go、Shell、JSON、YAML；右侧语法高亮预览，发送时作为文本上下文。回答含代码块时可查看与附件的 Diff，确认后选择原文件保存；若文件内容已变化则拒绝覆盖。
- 多个 API Profile 各自保存连接、模型、思考强度和每百万 Token 的输入、输出价格；API Key 继续存放在系统凭据管理器。设置页可测试当前连接。
- 记录每次请求的 Token、耗时和按 Profile 单价估算的费用；界面显示单次、会话、今日和本月用量。思考 Token 从流式思考内容估算，具体数字以服务商账单为准。
- 搜索提供关闭、自动和强制模式，可选择 Claude 官方搜索或自建 SearXNG JSON 接口；来源卡片统一编号。
- 上下文支持完整、最近 N 轮、智能压缩与消息、附件手动选择。智能压缩会提取早期对话的短摘要，当前上下文 Token 指示为字符估算值。
- 侧栏「用量统计」打开独立 Dashboard：今日、7天、30天、本月及自定义日期筛选；可按模型、Profile 和会话分析，查看趋势图、对比图和单次请求明细。图表支持悬停查看数据、拖拽缩放，并随新请求刷新。

OpenAI Compatible Profile 使用 `/v1/chat/completions` 流式接口；联网搜索可配合 SearXNG 使用。各中转服务对用量字段的支持可能不同。

- 自定义 API Base URL、API Key 与连接测试；API Key 保存在 Windows Credential Manager。
- 在对话输入框旁切换模型，也可输入第三方服务提供的自定义模型 ID；支持思考强度设置。
- 多轮对话与流式输出；Markdown、代码高亮和 LaTeX 显示。
- 停止生成、重新生成、复制回答；新建、重命名和删除历史会话。
- 可选的 Claude Web Search 及搜索来源展示。该功能取决于所用 API 服务是否支持。
- Light / Dark / Follow System 主题；SQLite 本地保存会话历史。
- v0.1.1：选择、粘贴或拖拽 PNG/JPEG/GIF/WebP 图片，在发送前预览。
- v0.1.1：上传 PDF、DOCX、UTF-8 TXT 或 Markdown（.md），Rust 提取文本并作为会话上下文；扫描版 PDF 需先 OCR。
- 为避免超大请求，每个文档每次最多发送前 16,000 字符，单次请求的文档文本合计最多 24,000 字符；原文仍保存在本地历史中。超过 20 万字符的文档需拆分上传。
- v0.1.1：按标题、消息或附件提取文本搜索历史；导出完整会话为 Markdown 或 PDF。
- v0.1.1：历史搜索由侧栏放大镜展开；首条消息自动确定简短标题；点击文档附件可在右侧预览 Markdown 或提取文本。
- 删除对话前会再次确认。新上传的 Markdown 可预览同目录或子目录中的相对路径图片；PDF 显示原始文件，DOCX 显示正文及内嵌图片。旧版本上传的文档若只保存了提取文本，需重新上传以显示原图。
- v0.1.1：设置全局 System Prompt，或为单个会话指定独立 Prompt。

## 与 Claude Code 命令行版相比

两者用途不同：ClaudeChat 为日常对话设计；[Claude Code 命令行版](https://code.claude.com/docs/en/overview) 主要用于读取代码、修改文件和执行开发命令。Claude Code 也提供桌面图形界面，下表仅比较其命令行使用方式。

| 对比项 | ClaudeChat | Claude Code 命令行版 |
| --- | --- | --- |
| 主要用途 | 日常问答、多轮聊天、文档与图片输入和按需联网搜索 | 编程、理解代码库、修改文件与运行命令 |
| 操作方式 | 独立 Windows 聊天窗口，侧边栏管理会话 | 在终端输入指令，围绕项目目录工作 |
| 开始使用 | 下载 Windows 安装程序，双击安装后在设置页填入 API 信息 | 安装命令行工具，再从终端启动 |
| API 配置 | 设置页直接填写 Base URL、API Key、模型，并测试连接 | 使用登录流程、环境变量或配置文件；具体接入方式取决于服务 |
| 对话管理 | SQLite 本地保存历史；界面内搜索、重命名和删除会话 | 支持会话历史，更侧重项目开发流程 |
| 执行范围 | 聚焦对话；仅在用户查看 Diff 并确认后保存选定的代码文件，不执行开发命令 | 可读取、编辑文件并运行命令，适合开发自动化 |

ClaudeChat 适合想直接聊天、自己选择 API 地址和模型的 Windows 用户；需要自动运行开发工具时，Claude Code 更合适。两者的费用与 Token 消耗取决于模型、服务商和具体任务。

## 后续计划

继续完善各 Provider 的真实服务兼容性及模型元数据识别；旧版 `.doc` 请先转换为 `.docx`。

## 技术栈

Vue 3、TypeScript、Tailwind CSS、Tauri 2、Rust、SQLite。

## 开源协议

本项目采用 [MIT License](LICENSE)。
