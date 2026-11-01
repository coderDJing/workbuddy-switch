# WorkBuddy Switch Next 维护说明

本仓库基于 [changexbc/workbuddy-switch](https://github.com/changexbc/workbuddy-switch)，在 [coderDJing/workbuddy-switch](https://github.com/coderDJing/workbuddy-switch) 继续维护。保留上游版权与 MIT 许可，修复仍可向上游提交。

## 项目名称

用户于 2026-11-01 选定 **WorkBuddy Switch Next**。项目介绍、应用侧栏、网页/桌面窗口标题及系统通知使用该名称；简介为“持续维护的 WorkBuddy 多账号管理工具，支持桌面 GUI 与 CLI”。保留原项目来源、版权与 MIT 许可。

当前仓库地址仍是 `coderDJing/workbuddy-switch`。本次先统一展示名称；安装包 productName、应用 identifier、CLI 命令、npm 包名及更新源随独立发布一起迁移，避免名称与打包脚本或用户数据路径脱节。尚未发布独立 Next 安装包或 npm 包。

## 产品维护范围

用户于 2026-11-01 明确要求按完整产品接续维护，实际同时使用 GUI 与 CLI。维护范围覆盖桌面 App、npm/webui、一次性 CLI，以及原产品支持的国内/国际版客户端接入；账号管理、认证与切换、积分和 Token 统计、会话复制/关联/同步、签到与旅行、悬浮窗及升级发布均纳入维护。

功能优先级按完整用户流程、影响程度和依赖排序。GUI 的置顶、排序、跨账号会话和悬浮窗等功能有独立价值；不再以 CLI 使用比例作为搁置 GUI 功能的依据。上游停更状态与维护者意图分开描述，本分支以可复现问题、代码审查和验证结果决定吸收内容。

## 维护基线

2026-11-01 建立 `codex/maintained-fork` 维护分支，基于上游 v0.1.62（`22b318c`），包含已有的 8 个增量提交，末端为 `f73451e`。`origin` 指向自己的仓库，`upstream` 指向原仓库。

| 范围 | 已有增量 |
| --- | --- |
| CLI 与并发 | 一次性账号、积分与限额查询和切换；共享认证与积分事务协调 |
| GUI 同步 | 感知外部 CLI 更新，拒绝迟到响应 |
| 认证恢复 | 认证恢复后清理残留的重新登录提示 |
| 凭据保护 | 防止旧扫码凭据回滚，保留刷新后 RT 到期信息；导出与令牌刷新串行化，保留已记录的刷新时间 |
| 开发验证 | CLI 文档与三平台测试流程 |

详细用法见 [CLI 文档](cli.md)，认证修复范围见 [认证恢复说明](auth-recovery.md)。上述内容是维护基线清单，不能替代测试结果或证明某个真实账号已恢复。

本轮修复统计测试的输入隔离：`WB_SWITCH_HOME` 不会重定向客户端日志目录，原测试会扫描本机历史。现在通过内部路径参数使用四组临时样本，并分别核对每个来源的 Token 数和记录数，避免测试耗时与个人日志体积相关。

## 上游 PR 整合（2026-11-01）

本轮审查的 18 个开放 PR 均已处理：14 个吸收或按当前架构改造，4 个由维护基线中的等价实现覆盖。没有将整批 PR 原样合并；存在依赖、旧快照及安全边界差异时，保留当前实现并补充测试。下表作者为所审查 head 的 Git 提交作者，版权与 MIT 许可继续保留。

| 来源 | 提交作者 / 审查时 head | 本分支结果 |
| --- | --- | --- |
| [#208](https://github.com/changexbc/workbuddy-switch/pull/208) | bao.x / `16a34d5` | 扩充 JetBrains 系列与 Android Studio 的目录、进程、显示名称及切换入口 |
| [#207](https://github.com/changexbc/workbuddy-switch/pull/207) | Nicholas / `0d663b1` | 复制/同步会话时同步置顶；仅处理本次选中且成功同步的会话，保留目标顺序及未知字段，写前备份 |
| [#206](https://github.com/changexbc/workbuddy-switch/pull/206) | Nicholas / `1a49478` | 保留原始 created_at；允许归档陈旧 active，但目标客户端仍运行时拒绝该操作 |
| [#203](https://github.com/changexbc/workbuddy-switch/pull/203) | Coder / `8f958a7` | 已有等价实现：导出认证保留已记录刷新时间 |
| [#202](https://github.com/changexbc/workbuddy-switch/pull/202) | Coder / `6645100` | 已由现有统一认证事务锁覆盖，避免切换写回刷新前令牌，不再引入第二套锁 |
| [#201](https://github.com/changexbc/workbuddy-switch/pull/201) | Luo-0712 / `b94b7a4` | 按账号 Token/调用统计与 GUI 筛选；归因冲突或身份不足保留为未归属，CLI 身份日志改为流式读取 |
| [#199](https://github.com/changexbc/workbuddy-switch/pull/199) | xshun978-svg / `536e428` | 空配置使用 08:00–22:00 分散签到窗口，每轮最多 8 个并错开请求；轮转游标防止认证失败账号挤占后续账号 |
| [#191](https://github.com/changexbc/workbuddy-switch/pull/191) | Coder / `9e9f361` | 维护基线已包含：认证恢复后清理重新登录提示 |
| [#186](https://github.com/changexbc/workbuddy-switch/pull/186) | Tenc Yao / `bec461d` | WebDAV 加密备份、选择恢复与双向同步，补齐下述并发、凭据新旧及失败恢复保护 |
| [#184](https://github.com/changexbc/workbuddy-switch/pull/184) | broadteam / `852144c` | 最近切换记录与多维排序；记账在认证锁内重读，CLI 复用已有事务锁 |
| [#181](https://github.com/changexbc/workbuddy-switch/pull/181) | Coder / `e516e5e` | 维护基线已包含：一次性 CLI 切号及账号、积分、限额查询 |
| [#162](https://github.com/changexbc/workbuddy-switch/pull/162) | Nicholas / `d533a7b` | 切换统计账号时保留请求用量 Tab |
| [#137](https://github.com/changexbc/workbuddy-switch/pull/137) | zhangjia / `e917774` | 保留较新的 Companion 0.2.2 / `14430ef` 基线，吸收过滤及兼容补丁机制，未回退到 PR 的旧快照 |
| [#121](https://github.com/changexbc/workbuddy-switch/pull/121) | dh0827 / `7887c7b` | 悬浮窗权限等待状态、会话生命周期、工程跳转与音效修复，并保留较新内部会话过滤 |
| [#120](https://github.com/changexbc/workbuddy-switch/pull/120) | dh0827 / `a7ee2d1` | 每分钟读取限额台账，失败保留已有结果；补请求序号与关闭/卸载失效处理 |
| [#119](https://github.com/changexbc/workbuddy-switch/pull/119) | dh0827 / `03da50c` | Windows 优雅关闭、UTF-8 输出与启动兜底；等待完整原进程集合退出，保留内核进程句柄避免 PID 复用误判 |
| [#118](https://github.com/changexbc/workbuddy-switch/pull/118) | dh0827 / `c4fa89c` | 补扫共享插件宿主日志；只接受日志中的认证 UID，不借用 CN IDE 当前账号 |
| [#29](https://github.com/changexbc/workbuddy-switch/pull/29) | zhangjia / `3029c55` | 按当前多目标架构重做 CN IDE 优雅关闭、SQLite 一致性备份、事务写入及解密回读验证；退出不明时不写库 |

### WebDAV 接纳边界

- 加密使用 AES-256-GCM 与 PBKDF2；新备份同时认证头部，限制可接受的 KDF 迭代范围，兼容已有格式读取。
- 首次上传使用 If-None-Match；覆盖已有备份必须取得强 ETag。同步先完成带条件的远端上传，再持认证锁核对本地原始内容；远端竞争或本地并发修改均不会被静默覆盖。
- 账号按 UID 与客户端类型匹配，保留本地账号 ID、创建时间、备注及最近使用信息。不同凭据只接受有明确较新刷新时间的版本，旧版本跳过，时间相同或未知的冲突报错。
- 恢复预览绑定加密备份 SHA-256，预览后云端变化必须重新读取。配置写入保留备份和回滚记录；后续失败时恢复此前配置，遇到外部并发修改则停止覆盖并报告备份位置。

### Companion 来源与补丁

保留 `14430ef9f3ec592f2c898fb088800cc7b7a70097` / 0.2.2 快照。`patches/agent-companion/host-compatibility.patch` 与版本清单记录维护差异。已实际从该固定提交归档、应用补丁并核对全部 292 个文件；不是仅检查补丁语法。更新脚本的回归测试覆盖幂等、忽略未提交源码以及失败保留原快照。

## 后续维护

本轮完成上表 PR 的整合，不等于所有上游 Issue 已解决。后续仍需调查跨账号副本不可见（#200）、IDE 新增关联入口（#195）、批量归档选择（#165）、企业登录（#177）及旧 WebKit（#196）。工作记忆、专家团、自动化跨账号迁移（#209、#154、#150）需另行确认数据所有权及恢复路径。

维护范围继续覆盖完整 GUI 与 CLI、签到/旅行、悬浮窗和平台发布。定期检查上游差异，按具体问题保留复现、实现与验证；不因 CLI 使用比例而搁置 GUI 功能。账号库、认证文件、扫码候选、凭据日志和签名私钥不得提交 Git。

## 验证

2026-11-01 Windows 本机结果：

- 主前端 108 项测试、生产构建通过；演示界面检查了排序、统计 Tab 保留、按账号 Token 筛选及切换来源重置、WebDAV 设置卡片。
- 核心完整单测 850 项及集成测试通过；随后新增的 Windows 进程句柄身份单测单独通过。WebDAV 端到端测试使用本地模拟服务及三个隔离设备目录，覆盖加密、合并、竞争和恢复预览失效。
- CLI/server 的 35 项单测、21 项端到端测试及 2 项摘要测试通过；npm launcher 5 项通过、1 项仅 Unix 测试在 Windows 跳过。
- Tauri 桌面 34 项测试通过；主程序 core/server/Tauri 的 lib、bins、tests 严格 Clippy 通过。
- Companion 前端 177 项通过、4 项跳过；类型检查、lint、构建及 bundle 检查通过。Rust workspace 146 项测试通过，Rust/Node 状态回放一致性检查通过。
- `npm run build:desktop` 通过，包含优化构建的原生 Companion runtime；该真实可执行文件通过隔离目录下的 hooks、异步等待/回答、双客户端、服务锁、所有权交接及认证 RPC 检查。
- Companion 固定基线补丁重放及文件逐一核验通过；三平台 CI 已补充 Companion 前后端检查。

上述账号、认证、会话和 WebDAV 测试使用合成数据或隔离目录，未切换本机实际保存账号，也未连接用户真实 WebDAV 服务。macOS/Linux 及真实客户端切换尚未在本机验证，配置 CI 不代表远端已通过。

常用命令：`npm test`、`npm run build`、`cargo test -p wb-switch-core`、`cargo test -p wb-switch-server`、`cargo test -p wb-switch-rust`、`node --test npm/tests/cli-launcher.test.cjs`、`npm run build:desktop`。Companion 验证命令及集成说明见 [集成文档](agent-companion-integration.md)。

## 发布状态

本次建立维护分支不发布安装包，也不发布 npm 包。README 中的下载与演示链接仍指向上游；上游安装包不包含本分支新增修复。

当前自动更新配置、默认更新仓库和 npm 分发仍沿用上游设置。从源码构建不代表已建立独立更新渠道。发布自己的维护版前，应统一处理版本标识、更新地址、签名、npm 包名与安装/下载说明，验证从旧版升级时的行为，再发布对应产物。
