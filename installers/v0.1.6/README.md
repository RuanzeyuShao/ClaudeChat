# ClaudeChat v0.1.6 · Windows x64

[下载安装包](https://github.com/RuanzeyuShao/ClaudeChat/raw/refs/heads/v0.1.6/installers/v0.1.6/ClaudeChat_0.1.6_x64-setup.exe)

运行 `ClaudeChat_0.1.6_x64-setup.exe`，更新前退出旧版程序。安装使用无需 Node.js 或 Rust。

本版修复引用定位切换分支、草稿重复写附件、自动联网和续写费用不透明、上下文选择不保存、历史读取与来源记录性能等问题；增加原始错误详情、删除此轮、数据维护和首次 API 配置入口。

- [修改清单与验证报告](../../docs/v0.1.6-test-report.md)
- [更新日志](../../CHANGELOG.md)
- [SHA-256 校验](SHA256SUMS.txt)
- [构建清单](manifest.json)

旧库首次升级后会复制到 Tauri 应用数据目录并迁移，原库保留作升级前备份。普通删除保留历史账单；清空全部数据会移除当前数据库及相关系统凭据，需要两次确认。

此目录通过 `v0.1.6` 分支交付源码、安装包与校验信息。
