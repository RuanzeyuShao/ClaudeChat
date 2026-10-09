<div align="center">
  <img src="src-tauri/icons/icon.png" alt="ClaudeChat" width="88" height="88" />
  <h1>ClaudeChat</h1>
  <p>自由配置模型、本地保存对话的 Windows 桌面聊天客户端</p>
  <p>
    <a href="https://github.com/RuanzeyuShao/ClaudeChat/releases/download/v0.1.4/ClaudeChat_0.1.4_x64-setup.exe"><strong>下载 Windows x64 · v0.1.4</strong></a>
    · <a href="https://github.com/RuanzeyuShao/ClaudeChat/releases/tag/v0.1.4">Release / Assets</a>
    · <a href="https://github.com/RuanzeyuShao/ClaudeChat/tree/v0.1.4">v0.1.4 源码</a>
  </p>
</div>

ClaudeChat 面向日常问答、写作、文档阅读和代码讨论。支持 Claude、GPT、DeepSeek、Kimi、GLM、Grok，以及自定义 OpenAI 兼容 API；可在同一会话中更换服务、连接配置和模型，保留聊天历史与附件。

## 下载与安装

点击上方下载入口，运行 `ClaudeChat_0.1.4_x64-setup.exe` 即可安装。使用安装包无需安装 Node.js 或 Rust；更新前请先退出正在运行的 ClaudeChat。

[Release 页面](https://github.com/RuanzeyuShao/ClaudeChat/releases/tag/v0.1.4)的 **Assets** 同时提供 [SHA-256 校验文件](https://github.com/RuanzeyuShao/ClaudeChat/releases/download/v0.1.4/SHA256SUMS.txt)和构建清单。无法直接下载时，可使用 [版本分支中的安装包备份](https://github.com/RuanzeyuShao/ClaudeChat/tree/v0.1.4/installers/v0.1.4)。

你需要自己的 Provider API Key；模型调用费用由对应服务商收取，支持的模型和能力取决于所选 API 或中转站。

## 开始使用

1. 打开 **设置 → API 配置**，新建连接并选择正确的服务类型。
2. 填写服务商提供的 **API 地址（Base URL）** 和 **API Key**。
3. 获取模型列表后选择模型，或手动填写模型 ID；按需设置默认思考强度和价格。
4. 点击 **测试连接**，确认可用后选择 **保存并启用**，即可开始聊天。测试会发起一次简短 API 请求。

聊天时，点击输入框底部的模型按钮即可选择 Provider、API Profile 和模型。**选中模型只收起模型列表，配置界面继续保留**；完成思考与搜索设置后，点击 **应用配置**，下一轮消息使用新配置。

正在生成时可以查看并暂选配置；停止或完成当前回答后才能应用。在 **设置 → API 配置** 中同样先保留编辑草稿，再通过 **保存配置** 或 **保存并启用** 提交。保存其他未启用的 Profile 不会自动切换当前聊天连接。

## 主要功能

| 功能 | 说明 |
| --- | --- |
| 多模型对话 | 多个 Provider 和 API Profile、自定义地址与模型 ID、流式输出、思考模式、停止生成与会话内切换 |
| 对话树与上下文 | 编辑重发、重新生成、继续生成、回答版本与分支；支持消息引用和上下文选择 |
| 附件与预览 | 图片、PDF、DOCX、TXT、Markdown 和代码附件；支持预览、代码高亮与 Diff，识图能力取决于模型 |
| 联网与来源 | Provider API 搜索或 SearXNG；来源去重、引用编号保留、默认显示前三项并支持展开 |
| 会话与用量 | 历史搜索、置顶、文件夹、标签、Prompt 预设、Markdown / PDF 导出；Token、耗时和费用统计 |
| 界面与阅读 | Light / Dark / System 主题、侧栏调整与响应式布局；向上阅读暂停跟随，新回答在输入框上方提示 |

## 联网搜索怎么配置

在 **通用偏好** 或当前服务配置的 **高级选项** 中选择搜索服务，再在输入框选择 **自动联网** 或 **始终联网**。

| 搜索服务 | 使用条件 |
| --- | --- |
| Provider API 内置搜索 | 当前模型、API 地址和账号须支持对应搜索工具；网页端能联网，不代表同名 API 模型也能联网 |
| SearXNG | 填写可访问、已启用 JSON 搜索结果的 SearXNG 实例地址；由实例检索资料，再交给当前模型回答 |

当前客户端已接入 Claude、OpenAI、Kimi 和 GLM 的部分 API 搜索路径，仍需具体模型支持；GPT 的 Chat Completions 搜索需要搜索专用模型。DeepSeek、Grok 和通用 OpenAI 兼容连接当前使用 SearXNG。

**自动联网**按问题中的关键词或问号触发；**始终联网**为每轮请求开启搜索。遇到“请先设置 SearXNG 地址”时，请填写实例地址，或切换为“不联网”。[详细搜索说明](https://github.com/RuanzeyuShao/ClaudeChat/blob/v0.1.4/docs/v0.1.4-search-confirm-report.md)

## 数据与费用

- 对话、附件、分支和偏好保存在本地 SQLite；Windows 下 API Key 保存在系统凭据管理器中。
- 发送消息时，所选上下文与附件内容会提交到你配置的 API；联网时也会使用所选搜索服务。
- 用量展示服务返回或客户端估算的数据，费用按配置的模型单价计算。实际计费以服务商账单为准。

## 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `Ctrl+N` | 新建对话 |
| `Ctrl+K` | 搜索历史会话 |
| `Ctrl+,` | 打开设置 |
| `Ctrl+L` | 返回聊天并聚焦输入框 |
| `Esc` | 关闭当前弹窗或退出统计页面 |
| `Enter` / `Shift+Enter` | 发送 / 换行；可在通用偏好改为 `Ctrl+Enter` 发送 |

## 开发与构建

<details>
<summary>展开源码运行、测试与打包命令</summary>

### 环境

技术栈为 **Vue 3 + TypeScript + Tauri 2 + Rust + SQLite**，样式使用 Tailwind CSS 与项目主题变量。

准备 Node.js、Rust 和 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)。Windows 构建还需 C++ 构建工具与 WebView2；浏览器回归默认使用 Microsoft Edge。

当前发布版本源码在 `v0.1.4` 分支，运行或构建该版本请从此分支检出：

```powershell
git clone --branch v0.1.4 https://github.com/RuanzeyuShao/ClaudeChat.git claude-chat
cd claude-chat
npm ci
npm run tauri:dev
```

### 验证

```powershell
npm run test
npm run test:ui
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

### Windows 安装包

```powershell
npm run tauri:build -- --bundles nsis
npm run release:collect
```

NSIS 安装包默认生成于 `src-tauri/target/release/bundle/nsis/`；收集脚本将安装包、校验值与验证资料整理到 `dist-release/v0.1.4/`。

</details>

## 文档与反馈

- [版本更新日志](https://github.com/RuanzeyuShao/ClaudeChat/blob/v0.1.4/CHANGELOG.md)
- [v0.1.4 验证报告](https://github.com/RuanzeyuShao/ClaudeChat/blob/v0.1.4/docs/v0.1.4-test-report.md)
- [界面设计说明](https://github.com/RuanzeyuShao/ClaudeChat/blob/v0.1.4/docs/v0.1.4-design.md)
- [反馈问题或建议](https://github.com/RuanzeyuShao/ClaudeChat/issues)：请说明版本、Provider、模型、错误提示及复现步骤。

## 开源协议

[MIT License](LICENSE) · Copyright © 2026 Zeyu Ruan
