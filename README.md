<div align="center">
  <img src="src-tauri/icons/icon.png" alt="ClaudeChat" width="88" height="88" />
  <h1>ClaudeChat · v0.1.6</h1>
  <p>自由配置模型、本地保存对话的 Windows 桌面聊天客户端</p>
  <p><a href="https://github.com/RuanzeyuShao/ClaudeChat/releases/download/v0.1.6/ClaudeChat_0.1.6_x64-setup.exe"><strong>下载 Windows x64 · v0.1.6</strong></a> · <a href="https://github.com/RuanzeyuShao/ClaudeChat/releases/tag/v0.1.6">正式 Release / Assets</a> · <a href="installers/v0.1.6/">校验与构建清单</a> · <a href="docs/v0.1.6-test-report.md">修改清单与验证报告</a></p>
</div>

支持 Claude、GPT、DeepSeek、Kimi、GLM、Grok 和自定义 OpenAI 兼容 API。需要自备 API Key，调用费用由服务商收取。

默认分支 **main 已包含完整 v0.1.6 源码、测试、发布资料，以及 2026-10-19 的搜索框关闭和设置按钮居中修复**。当前正式安装包也已包含这两项界面修复。

**2026-10-23 更新（仍为 v0.1.6）**：新会话首次发送后由 AI 概括标题，不再截取用户原文。标题在首轮正文结束后后台生成，后续追问、重新生成和重启均不会再次调用；手动改名优先，旧会话保留原有标题。

## v0.1.6 工作台 UI 更新（2026-10-30）

宽屏增加窄图标轨，详细侧栏保留现有服务和历史入口；统一外层留白、导航选中态、顶部按钮、正文层级和居中悬浮输入卡片。保留绿色品牌及全部主题、聊天功能和数据行为，版本仍为 v0.1.6。

[布局改动与验证说明](docs/v0.1.6-workbench-report.md)。页面顶部正式 Release 下载入口提供当前工作台优化版。

## v0.1.6 Motion 交互优化

已加入全局轻量动效：统一 120 / 180 / 260 / 450ms 动画规范，覆盖侧边栏、模型选择、消息、弹层、附件、来源、对话树和 Usage。支持系统减少动画；流式文字不逐 Token 播放动画，版本号和现有布局、8 套配色保持不变。

[Motion 安装包与校验资料](installers/v0.1.6-motion/) · [关键动效、性能边界及验证报告](docs/v0.1.6-motion-report.md)。**2026-10-26 已更新现有 v0.1.6 正式 Release 安装包**；该次发布为 Motion 优化版，现已包含后续工作台 UI 更新，版本号和已有标签保持不变。

## v0.1.6 更新

- AI 标题仅对每个新会话尝试一次，沿用首次请求的服务与模型；失败不影响聊天，也不会自动重试，可手动重命名。用量明细单独标注“AI 标题”。
- 查看历史引用只定位、高亮原消息；其他分支的引用以只读窗口显示。对话树的“恢复上下文”和历史回答重新生成需要确认。
- 草稿按会话保存，仅写文字与附件元数据；附件正文独立缓存，预览与发送时读取。单条草稿最多 256 KB。
- 自动联网按搜索、实时信息等明确意图触发，问号本身不触发。输入框可为下一条消息单独选择联网模式，发送前显示检索方式和上下文数量。
- 默认自动续写 1 次、自动恢复 0 次；在通用偏好中可设置续写 0–2 次、恢复 0–3 次。达到上限后可点击“继续生成”。生成状态显示累计调用次数和已记账费用估算。
- 保留友好错误提示，同时提供可展开、可复制的原始错误详情；隐藏常见密钥字段。
- 上下文选择、最近轮数按会话持久保存。历史读取改为批量 SQL，来源记录按条更新；用量按时间范围、每页 500 条读取，搜索最多返回 50 个会话。
- 新增“删除此轮”、未引用附件与来源清理，以及两次确认的“清空全部数据”。删除一轮会永久删除该问题及其回答和后续分支；普通删除保留历史费用账单。
- 统一单附件 20 MB、每条消息最多 8 个附件、合计 30 MB；原生文件选择与拖入走路径解析。首次使用可直接点击“连接你的 API”。

逐项对应 A1–D6 的实现、迁移说明与验证结果见 [版本报告](docs/v0.1.6-test-report.md)，历史变更见 [CHANGELOG](CHANGELOG.md)。

## 安装与开始使用

运行 `ClaudeChat_0.1.6_x64-setup.exe`，更新前先退出旧版程序。安装使用无需 Node.js 或 Rust。

1. 点击“连接你的 API”，或打开“设置 → API 配置”。
2. 新建 Profile，填写服务类型、完整 Base URL、API Key 和模型 ID。
3. 点击“测试连接”，确认后“保存并启用”。测试连接会产生一次简短模型请求。
4. 在输入框底部选择当前服务、模型、思考强度。配置面板选择模型后仍保持打开，点击“应用配置”后生效。

支持图片、PDF、DOCX、Markdown、文本与代码附件，文档文字支持 UTF-8。可预览原文、导出 Markdown / 中文 PDF、编辑重发、引用多条消息、查看回答版本和对话树。

界面提供 8 套配色与浅色 / 深色 / 跟随系统、12–24 px 字体、长对话导航轨道、可调整的侧栏及文档预览宽度。

## 联网与费用

默认使用自动联网；普通知识问答不会仅因包含 `?` / `？` 而检索。诸如“搜索”“最新”“今天”“天气”等意图会触发。输入框联网选择仅影响下一条发送；默认行为在连接配置中调整。

搜索可使用 Provider API 内置工具或 SearXNG。具体 API 地址、账号与模型须支持该工具；DeepSeek、Grok、通用 OpenAI 兼容连接使用 SearXNG。选择搜索专用模型时会额外调用该模型，发送前会显示“将调用搜索模型”。搜索模型因长度或中断未完成时，仍可基于已获取资料回答并保留检索受限提示；安全拒绝会停止请求。

自动续写、自动恢复、工具往返与独立搜索都会增加调用。状态条的费用是已返回用量的累计估算，当前尚未结束的调用可能还未入账；图片 token 和实际费用以服务商账单为准。上下文预览的 token 为文字字符估算，不含模型特有的图片计费。

AI 标题额外调用当前模型一次，仅使用首条文字和有限附件文字片段，不发送图片 base64，不开启联网与额外思考，输出上限 128 token、超时 15 秒。该调用独立记账；首轮主动停止或标题任务开始前已手动改名时会跳过，不在后续追问中补调用。

## 本地数据

当前发布平台为 **Windows x64 / NSIS**。SQLite 位于 Tauri 解析的应用数据目录，通常为 `%APPDATA%\com.ruanzeyu.claudechat\claudechat.db`。API Key 保存在 Windows 凭据管理器。

首次升级会一致性复制旧 `%APPDATA%\ClaudeChat\claudechat.db`，再在新库事务中迁移来源表与草稿；原库保留为升级前备份。之后始终打开新目录，不回退到工作目录。已有新库不会被旧库覆盖。升级前备份、手动导出的文件不在应用内清库范围内。

“设置 → 通用偏好 → 本地数据维护”可清理未引用附件与来源。“清空全部数据”会删除当前数据库中的聊天、附件、配置、偏好、用量及对应系统密钥，需先确认再输入“清空”。不要在需要保留聊天时使用此功能。

## 快捷键

| 快捷键 | 操作 |
| --- | --- |
| Ctrl+N | 新建或复用未发送的空会话 |
| Ctrl+K | 搜索历史会话 |
| Ctrl+, | 打开设置 |
| Ctrl+L | 返回聊天并聚焦输入框 |
| Esc | 关闭当前弹窗或统计页面 |
| Enter / Shift+Enter | 发送 / 换行；可改为 Ctrl+Enter 发送 |

## 开发、验证与打包

准备 Node.js、Rust、Windows C++ 构建工具和 WebView2。浏览器测试使用 Microsoft Edge。

```powershell
git clone https://github.com/RuanzeyuShao/ClaudeChat.git claude-chat
cd claude-chat
npm ci
npm run tauri:dev
```

```powershell
npm test
npm run test:ui
npm run build
npm run release:check
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri:build -- --bundles nsis
npm run release:collect
```

安装包生成于 Cargo target 目录的 `release/bundle/nsis/`，收集到 `dist-release/v0.1.6/`。仓库中的发布包位于 [installers/v0.1.6](installers/v0.1.6/)。

`main` 维护完整项目，版本分支保留发布线；正式发布前将版本分支合入 `main`，同步 README、版本文件及发布资料，再运行 `npm run release:check`。该检查也会在面向 `main` 的提交和 Pull Request 中运行，防止首页版本、构建版本与安装包校验信息再次脱节。流程见 [发布维护说明](docs/release-process.md)。

[反馈问题](https://github.com/RuanzeyuShao/ClaudeChat/issues)时请附版本、Provider、模型、错误详情和复现步骤。

[MIT License](LICENSE) · Copyright © 2026 Zeyu Ruan
