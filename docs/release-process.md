# 发布与默认分支维护

`main` 是仓库默认分支，应包含最新正式版的完整源码、依赖锁文件、测试、报告与安装资料。版本分支用于保留发布线，不能仅把首页 README 改成新版本而留下旧代码。

## 发布顺序

1. 在版本分支完成代码、验证与安装包构建，同步 package.json、package-lock.json、Cargo.toml、Cargo.lock 和 tauri.conf.json。
2. 将版本分支合入最新 `main`，保留两边历史；核对合并冲突，确保最新代码和报告完整进入默认分支。
3. 更新首页版本标题、功能说明、安装包入口、Release 页面与校验资料。下载链接指向正式 Release 的 Assets。
4. 运行 `npm run release:check`、适用的单元测试与构建检查。安装包与 manifest、SHA256SUMS、verification 和报告中的哈希必须一致。
5. 提交并推送 `main`，发布或更新 Release 后通过 GitHub API 核对默认分支、最新正式版本、下载文件大小与 SHA-256。

## 一致性检查

`npm run release:check` 无需安装额外依赖，会核对前端与 Rust 版本、首页当前版本及 Release 链接、相对文件链接、安装包名称/大小/哈希、构建清单和验证记录。

`.github/workflows/release-consistency.yml` 在推送 `main`、向 `main` 提交 Pull Request、正式 Release 发布/编辑或手动触发时运行检查。Pull Request 验证候选代码的内部一致性；其他事件额外运行 `--github` 在线检查，核对默认分支仍是 main、默认分支版本等于最新正式 Release、发布安装包的大小/哈希一致，以及构建源码已经合入 main。

在线检查命令：`node scripts/check-release.mjs --github`。它在合并推送和 Release 发布完成后执行；发布新版本的中间阶段如出现版本不一致，检查会失败，完成同步后可重新运行。

## v0.1.6 同步记录

2026-10-19，将包含搜索关闭和设置按钮居中修复的 `v0.1.6` 分支完整合入 `main`。原主分支的独立 README 提交保留在合并历史中；首页改为 v0.1.6 正式下载入口，代码、测试与发布资料一起同步。安装包保持已发布的界面修复版本，SHA-256 为 `2c98ac2ca7bbc4ff2b2c4bf0369dd07d129cc40cb5d147d895a8d342ea03c00d`。

既有 Release 标签保留原发布节点；同版本更新安装包时，准确的构建源码由 Release 更新记录与 manifest.sourceCommit 标明，不能仅凭标签猜测更新安装包的构建源码。
