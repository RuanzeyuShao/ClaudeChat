# ClaudeChat v0.1.6 Motion 优化安装包

Windows x64 NSIS 安装包：[ClaudeChat_0.1.6_x64-setup.exe](ClaudeChat_0.1.6_x64-setup.exe)。安装前退出旧版，版本号仍为 0.1.6。

本目录是新的 Motion 优化构建，**没有发布或替换 GitHub Release，也没有移动已有标签**。正式发布资料仍位于 `../v0.1.6/`，两份安装包通过目录、manifest 和 SHA-256 区分。

- [构建清单](manifest.json)：准确源码提交、构建时间、文件大小和 SHA-256。
- [校验文件](SHA256SUMS.txt)：与安装包同目录执行 `Get-FileHash .\ClaudeChat_0.1.6_x64-setup.exe -Algorithm SHA256` 后核对。
- [测试结果](verification.json) 与 [完整说明](../../docs/v0.1.6-motion-report.md)。

测试在隔离的临时 SQLite 中执行，没有迁移或清空用户现有数据。本次没有改变数据库结构、API 配置存储或 Usage 计算。
