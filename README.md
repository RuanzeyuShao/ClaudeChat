# ClaudeChat

基于 **Tauri 2 + Vue 3 + Rust** 的本地 Claude 桌面客户端。会话记录保存在 `%APPDATA%/ClaudeChat/claudechat.db`，API Key 使用 Windows Credential Manager（`keyring`）保存。

## 已实现（V1）

- 新建、重命名、删除和重新生成会话回复；SQLite 本地历史记录
- Anthropic Messages API 多轮对话与 SSE 流式显示
- Markdown 渲染和代码块高亮
- Claude Web Search 工具开关及来源链接展示
- 停止生成、模型选择和 API Key 设置

## 启动

1. 安装 Node.js 20+ 和 [Rust](https://www.rust-lang.org/tools/install) stable（Windows 还需安装 Visual Studio 的 C++ Build Tools）。
2. 在项目目录运行 `npm install`。
3. 使用 `npm run tauri:dev` 启动开发版；首次运行在“设置”中填写 Anthropic API Key。
4. 使用 `npm run tauri:build` 生成 Windows 安装包/可执行文件。

仅查看前端界面可运行 `npm run dev`；该模式使用本地演示回复，不会调用 API。
