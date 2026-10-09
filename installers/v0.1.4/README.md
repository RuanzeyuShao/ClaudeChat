# ClaudeChat v0.1.4 Windows x64 安装包

[下载 EXE 安装包](https://github.com/RuanzeyuShao/ClaudeChat/raw/refs/heads/v0.1.4/installers/v0.1.4/ClaudeChat_0.1.4_x64-setup.exe)

更新前请退出正在运行的 ClaudeChat，然后运行安装包。应用版本保持 0.1.4，安装包包含本分支的 UI、模型配置、Dashboard 与长对话滚动修复。

- `ClaudeChat_0.1.4_x64-setup.exe`：Windows x64 NSIS 安装包。
- `SHA256SUMS.txt`：安装包的 SHA-256 校验值。
- `manifest.json`：版本、大小、构建时间、源码提交及校验值。

在 PowerShell 中核对下载的文件：

```powershell
Get-FileHash -Algorithm SHA256 .\ClaudeChat_0.1.4_x64-setup.exe
```

将结果与 `SHA256SUMS.txt` 比较。[更新日志](../../CHANGELOG.md)和[验证报告](../../docs/v0.1.4-test-report.md)随源码提供。

本次安装包通过 `v0.1.4` 分支交付，没有创建新的 GitHub Release 或修改已有标签。
