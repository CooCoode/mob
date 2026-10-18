# 桌面端与 mobd 仓库拆分

2026-10-15 起，`mob` 只维护桌面端，办公室服务由独立的
[mobd 仓库](https://github.com/xrdavies/mobd) 维护。移动端和官网仍在各自仓库。

## 目录与命令

原 `apps/mob/` 已提升到仓库根目录，`src/`、`src-tauri/`、`public/`、
`package.json` 和 lockfile 都位于根目录。前端 `.env.example` 也在根目录。
Go 源码、服务配置示例、安装脚本和服务端设计文档已迁出。

| 旧命令（mob 根目录） | 新命令（mob 根目录） |
| --- | --- |
| `make app-install` | `make install` |
| `make app-dev` | `make dev` |
| `make app-desktop` | `make desktop` |
| `make app-test` | `make test` |
| `make app-build` | `make build` |
| `make app-bundle` | `make bundle` |
| `npm --prefix apps/mob ...` | `npm ...` |

原服务端 `make build/init/start/serve/restart/stop/status/logs` 改在 `../mobd`
执行。特别注意：**mob 的 `make build` 现在构建桌面前端**。
`make check` 检查桌面测试、类型和发布逻辑；不再需要 Go。

根目录 `.env` 只用于桌面 `MOBD_URL` 等配置。原服务端开发者
`.env` 应放在 mobd checkout，按照其 README 手动 export/source。已安装用户的
`~/.mobd/config.json`、LaunchAgent 标识、会话和附件路径保持不变。

## 独立发布

两个仓库各自打 `vX.Y.Z` 标签、创建 Release、签名和上传 R2，版本号不必一致。
只发布拆分后提交创建的新标签；历史 monorepo 标签不会变成独立产品的构建。

- mob 只维护 `mob/`，包含 DMG、Tauri 更新包和 `latest.json` / `releases.json`。
- mobd 只维护 `mobd/`，包含 CLI 归档、安装脚本和独立发布清单。
- 下载域名和产品路径不变，官网和已配置的 updater 不需要改 URL。
- 两端通过 HTTP/SSE 和实时桌面流（WebRTC / WebSocket）通信，以 `/health` 的 API 版本和功能判定兼容性；仓库版本号无需同步。

mob 保留原 `release` environment 的 Apple、Tauri 和 R2 配置，见
[桌面发布清单](releases.md)。mobd 新仓库需要单独配置 `release` environment；
Apple/R2 凭据可复用，但 GitHub 不会自动复制仓库 environment 配置。
Tauri 私钥和公钥只在 mob 配置。

## 历史记录

迁移基于 mob 提交 `0606c832acf9a9c2729ca468a1ddb9ba3e3e1ead`。
原 mob 历史保留，桌面文件的移动可通过 `git log --follow` 追踪。
mobd 采用独立初始提交，只迁入服务端及其构建、发布和文档，未复制完整 monorepo 历史。
