<div align="center">
  <img src="src-tauri/icons/icon.png" alt="ClaudeChat 图标" width="128" height="128" />
  <h1>ClaudeChat</h1>
  <p><strong>轻量、可控、低门槛的 Claude 风格桌面对话客户端</strong></p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" /></a>
</div>

**ClaudeChat 的目标，是做一个轻量、可控、低门槛的 Claude 风格桌面对话客户端。**

一方面保留对 Anthropic 官方 API 的支持，另一方面重点支持自定义 `Base URL` 和第三方中转站 API。本项目聚焦日常对话、多轮上下文、图片和文档输入、联网搜索。

## 下载并使用

**Windows 用户：[下载 ClaudeChat v0.1.1 安装程序（.exe）](https://github.com/RuanzeyuShao/ClaudeChat/releases/download/v0.1.1/ClaudeChat_0.1.1_x64-setup.exe)**

上方是 v0.1.1 的 Windows 安装包。也可从源码运行：安装 Node.js 和 Rust 后执行 `npm install`、`npm run tauri:dev`。

下载后双击安装，启动 ClaudeChat。首次使用时打开「设置」，填写 API Key；使用第三方兼容服务时，再填写该服务提供的 Base URL 和模型 ID。点击「测试连接」，成功后即可开始对话。无需安装 Node.js、Rust，也无需自行编译。

如果直达链接不可用，可前往 [v0.1.1 Release 页面](https://github.com/RuanzeyuShao/ClaudeChat/releases/tag/v0.1.1) 下载 `ClaudeChat_0.1.1_x64-setup.exe`。

> 使用本客户端需要可用的 Anthropic API 或兼容服务 API Key。第三方服务支持的模型、搜索能力及费用由相应服务决定。

## 当前功能

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
| 执行范围 | 聚焦对话，不会代替用户运行系统命令或修改项目文件 | 可读取、编辑文件并运行命令，适合开发自动化 |

ClaudeChat 适合想直接聊天、自己选择 API 地址和模型的 Windows 用户；需要让 AI 实际修改代码和运行开发工具时，Claude Code 更合适。两者的费用与 Token 消耗取决于模型、服务商和具体任务，不能仅凭客户端判断。

## 与 Claude Code 命令行版相比

两者用途不同：ClaudeChat 为日常对话设计；[Claude Code 命令行版](https://code.claude.com/docs/en/overview) 主要用于读取代码、修改文件和执行开发命令。Claude Code 也提供桌面图形界面，下表仅比较其命令行使用方式。

| 对比项 | ClaudeChat | Claude Code 命令行版 |
| --- | --- | --- |
| 主要用途 | 日常问答、多轮聊天和按需联网搜索 | 编程、理解代码库、修改文件与运行命令 |
| 操作方式 | 独立 Windows 聊天窗口，侧边栏管理会话 | 在终端输入指令，围绕项目目录工作 |
| 开始使用 | 下载 Windows 安装程序，双击安装后在设置页填入 API 信息 | 安装命令行工具，再从终端启动 |
| API 配置 | 设置页直接填写 Base URL、API Key、模型，并测试连接 | 使用登录流程、环境变量或配置文件；具体接入方式取决于服务 |
| 对话管理 | SQLite 本地保存历史；界面内搜索、重命名和删除会话 | 支持会话历史，更侧重项目开发流程 |
| 执行范围 | 聚焦对话，不会代替用户运行系统命令或修改项目文件 | 可读取、编辑文件并运行命令，适合开发自动化 |

ClaudeChat 适合想直接聊天、自己选择 API 地址和模型的 Windows 用户；需要让 AI 实际修改代码和运行开发工具时，Claude Code 更合适。两者的费用与 Token 消耗取决于模型、服务商和具体任务，不能仅凭客户端判断。

## 后续计划

更多 Provider 适配器。目前版本使用 Anthropic Messages API 格式；第三方地址需兼容该格式。旧版 `.doc` 请先转换为 `.docx`。

## 技术栈

Vue 3、TypeScript、Tailwind CSS、Tauri 2、Rust、SQLite。

## 开源协议

本项目采用 [MIT License](LICENSE)。
