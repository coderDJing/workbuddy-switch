# 开发与发布指南

Next 的发布身份与版本入口是 `release-config.json`。账号库与认证锁继续使用 `~/.wb-switch`，应用安装身份、更新配置与签名属于 Next。

## 环境与构建

Node.js 22、Rust stable（至少 1.89）及对应平台的 Tauri 构建依赖。

```bash
npm ci
npm run release:check
npm test
npm run build
cargo test -p wb-switch-core
cargo test -p wb-switch-server
```

桌面构建包含固定版本 Companion 前端与原生 runtime：

```bash
npm run build:desktop
# Windows 签名 NSIS 安装包
node scripts/build-release.mjs --target x86_64-pc-windows-msvc --bundles nsis
# macOS .app
npm run build:app:release
```

`build-release.mjs` 读取已配置的 TAURI_SIGNING_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY_PASSWORD，或本机 `~/.wb-switch-next/release-signing/updater.key` 与 `password.txt`。只加载到构建子进程，不输出密钥内容。

## 版本与分发身份

运行 `npm run version:set -- 0.2.0-beta.2` 同步前端、三个 Rust 包、Tauri、npm 主包和平台包；再运行 Cargo 命令更新 Cargo.lock。带预发布后缀的版本使用 preview 更新入口；正式版本使用 Releases latest 入口。

- 应用名称：WorkBuddy Switch Next。
- 应用标识：`io.github.coderdjing.workbuddyswitchnext`。
- npm 主包：`workbuddy-switch-next`。
- npm 平台包：`workbuddy-switch-next-<platform>-<arch>`。
- 主命令：`workbuddy-switch-next`；保留 `workbuddy-switch` 别名，JSON 输出协议及认证锁兼容。
- 原生 CLI 内部二进制仍为 `wb-switch`；它与 Cargo 包名属于内部构建标识。

## 更新签名

Next 使用自己的 Tauri updater 签名。当前机器的签名材料在用户目录 `~/.wb-switch-next/release-signing/`，公钥写入 `src-tauri/tauri.conf.json`。私钥与密码不得进入仓库，应单独备份；后续版本必须使用相同密钥以便已有安装验证更新。

新维护环境可用 `npm run tauri -- signer generate -w <私钥路径>` 生成新密钥，但已有用户安装后不能随意换钥。CI 使用仓库 Secrets：

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

这属于更新包签名，不等于 Windows Authenticode 或 Apple 公证。系统开发者签名可另外配置。

## GitHub Actions

`test.yml` 在 push / PR 上运行三平台测试与前端检查。`build.yml`：

1. 手动触发可选择 Windows、macOS ARM/Intel、Linux 或全部平台，仅上传构建 artifacts。
2. 先检查发布身份、版本、前端行为、核心与发布脚本；构建后收集 CLI、安装包、签名和平台更新清单。
3. 版本 tag 必须等于所有包的版本，例如 `v0.2.0-beta.1`。tag 构建四个平台，任一构建失败均不发布 Release。
4. 合并清单必须覆盖四种目标与 Linux 两种安装形态；所有清单的版本、下载来源、归档及签名必须一致。
5. 生成 SHA256SUMS，再发布版本 Release。预览版本另外更新名为 preview 的发布入口。

预览清单位于 `/releases/download/preview/latest.json`；清单里的实际安装包 URL 指向不可变版本 tag，避免拉取更新清单后入口移动导致版本错配。预览版不回退到 GitHub `/latest`，因为它不包含预发布版本。

macOS DMG 由固定版本 dmgbuild 制作，支持无 Finder 的 CI。Windows 安装包按实际 productName 与版本定位；清理旧产物通过 Node 原生文件操作限定在当前 target 的 bundle 目录。

## npm 发布

仓库变量 `PUBLISH_NPM` 必须显式设为 `true`，并提供有效 `NPM_TOKEN`，才会在 tag 构建中发布。当前为 false；桌面发布独立继续。平台包全部成功后才发布主包，预览版使用 npm dist-tag `next`。

本地可用 `npm pack --dry-run --json` 检查 npm 主包内容。安装脚本只从 Next 平台包复制二进制，不会回退到原作者的 npm 包。`WB_SWITCH_BINARY` 本地覆盖入口保留。

旧 npm 包与 Next 的兼容别名会占用相同全局命令路径。用户迁移时先正常卸载旧 npm 包再装 Next，账号库不需要移动或删除。

## 数据与配置兼容

Next 使用 `~/.wb-switch`，不复制或重建账号库。独立安装标识允许系统识别 Next；运行前退出不支持认证事务锁的旧版。

Next 更新配置为 `github_config_next.json`。首次读取原 `github_config.json` 时迁移原上游/旧 fork 地址并保留代理，只写新配置。自定义更新源保留，密钥验证仍使用 Next 公钥。恢复 WebDAV 配置也通过相同规范化入口。

测试和试装必须使用隔离的 WB_SWITCH_HOME；不调用真实切号来验证安装包。需要测试真实账号时另行记录客户端运行状态与授权范围。

## 图标

`npm run icons:generate` 从已批准的贝雷帽母图导出网页、桌面、已有移动端及托盘资源。Windows 圆角、单色托盘的表情与 N 镂空由导出脚本处理，设计来源与尺寸检查见维护说明。
