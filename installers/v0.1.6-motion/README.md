# ClaudeChat v0.1.6 Motion 优化安装包

Windows x64 NSIS 安装包：[ClaudeChat_0.1.6_x64-setup.exe](ClaudeChat_0.1.6_x64-setup.exe)。安装前退出旧版，版本号仍为 0.1.6。

本目录保留 Motion 优化构建及专项验证。经用户确认，**2026-10-26 已更新现有 v0.1.6 正式 Release**，版本号和已有标签不变。`../v0.1.6/` 的正式安装包与本目录为同一文件，SHA-256 相同。

- [构建清单](manifest.json)：准确源码提交、构建时间、文件大小和 SHA-256。
- [校验文件](SHA256SUMS.txt)：与安装包同目录执行 `Get-FileHash .\ClaudeChat_0.1.6_x64-setup.exe -Algorithm SHA256` 后核对。
- [测试结果](verification.json) 与 [完整说明](../../docs/v0.1.6-motion-report.md)。

测试在隔离的临时 SQLite 中执行，没有迁移或清空用户现有数据。本次没有改变数据库结构、API 配置存储或 Usage 计算。
