# dsh-plugin-hub

DeepSeek Harness 的插件市场：在 Web UI 的「设置 → 插件市场」里浏览一份自动维护、逐条校验过的 DSH 插件目录，一键装进你正在运行的 profile，也能一键卸载。

- **Verified installable** —— 每个标记为「已验证」的条目都经过确定性校验，能真的装上，而不是"看起来像插件"。
- **不必重启** —— 安装后插件当场挂载进运行中的插件树；只有带界面的插件需要刷新页面。
- **自动更新的目录** —— 数据每 2 小时由 GitHub Actions 重新采集、清洗、打标并发布，插件端按 ETag 条件拉取，无需重装。
- **默认可解释的排序** —— 打分公式公开（见下），不是黑箱推荐。
- **安装前明确告知风险** —— 装第三方插件等于在你机器上执行它的代码，确认框会列出仓库、作者、许可证与是否需要执行构建脚本。

## 为什么需要它

GitHub 上 `dsh-plugin` topic 有 1300+ 个仓库，但按 star 倒序看到的前 50 个里，只有 16 个的根 `package.json` 带 `dsh` 字段——排在最前面的是 PicGo-Core、mcp-for-stata 这类蹭 topic 的无关项目。而 0 star 的分片里，抽样 50 个有 42 个是真插件。

本项目一次全量采集（`dsh-plugin` + `deepseek-harness` + `dsh` 三个 topic）的实际结果：**1653 个仓库、1730 条目录条目，其中 257 条可一键 npm 安装、122 条可从源码安装**，总共只花了 151 个 GraphQL point（额度 5000/小时）。

**star 排序与"是不是真插件"负相关，真插件全埋在长尾。** 这个市场解决的就是这件事。

## 工作原理

`dsh-plugin-hub` 复用 DSH 的能力接缝（capability seam），没有另造一套机制：

| DSH 能力 | 插件用法 |
|---|---|
| `ctx.webServer.register()` | 提供目录与安装路由 `/plugin-hub/*` |
| `ctx.loader.create()` / `remove()` | 安装后当场挂载插件行、卸载时摘除（Loader 根是内存态，不写回配置） |
| `@deepseek-ai/dsh-app-boot` | 复用 `resolveProfileDir` / `readProfileManifest` / `writeProfileManifest` 对账 `dsh.profile.bundles` |
| `ctx.baseUrl` | 直接得到当前 profile 目录，无需猜 profile 名 |
| `settings.section` 槽位 | 在设置面板里注册「插件市场」一节，与「通用设置」「模型」并列 |
| `ctx.locale.register()` | 中英文文案 |

> 兼容性说明（两处都是踩过坑之后的选择）：
>
> 1. **槽位用 `settings.section` 而不是 `settings.plugins.tab`。** 后者只存在于较新的 DSH 构建；当前部署的运行时（`staging-20260811`）的设置面板只提供 `settings.trigger / header / action / close / section / onboarding`，根本没有插件分区。注册到没有宿主的槽位不会报错，只会**静默不渲染**。`settings.section` 在两种构建里都有。
> 2. **路由前缀用 `/plugin-hub` 而不是 `/plugins/dsh-plugin-hub`。** 后者属于 client-module 注册表，它从 `/plugins/<id>/client.js` 提供每个插件的浏览器 bundle；在那里注册 prefix 路由会**遮蔽掉本插件自己的 bundle**，表现为 UI 完全加载不出来。

数据流：**GitHub GraphQL + npm registry → 规则分级 → 大模型打标 → `data/v1/*.json` → 插件端 ETag 拉取 → 与本地已安装状态合并 → UI**。

安装流程：`pnpm add <spec>`（在 profile 目录）→ 按已安装状态对账 `dsh.profile.bundles`（决定**下次冷启动**）→ `ctx.loader.create()` 挂载插件行（**当场生效**）。两条路径互不干扰：热挂载只在内存里，冷启动只读 manifest，所以不会重复插入同一行。

## 分级模型

分级是这个市场的信任地基，**全部由规则决定，不经过大模型**：

| 分级 | 判据 | 行为 |
|---|---|---|
| `verified-npm` | **npm registry 的 manifest** 声明了 `dsh.bundle` | 一键安装（`pnpm add <包名>`） |
| `verified-git` | 未发布 npm，但同时有 `dsh.bundle`、合法的 `cordis.patch.yml`、**以及 `prepare` 脚本** | 一键安装（`github:owner/repo`），并警告安装时会执行构建脚本 |
| `likely-plugin` | 有插件特征但缺少可无人值守安装的条件（monorepo 子包、`private: true`、无 `prepare`） | 只展示，给出克隆+构建的手动步骤 |
| `related` | 生态周边（skills 包、CLI、文档），没有可挂载的 bundle | 只展示，不提供安装 |

`verified-git` 为什么必须要求 `prepare`：实测 40 个仓库里 29 个声明了 `dsh.bundle`，但只有 3 个有 `prepare` 脚本。**pnpm 安装 git 依赖时不会自动构建**，而所有插件都把 `lib/` 加进了 `.gitignore`——没有 `prepare` 就装出一个入口文件不存在的包，必然加载失败。以 npm 的 manifest 为权威来源，是因为它描述的正是 pnpm 真正会放进 profile 的东西。

## 排序公式

公开、可解释，**刻意不让 star 主导**（star 最多只占 3 分）：

```
score = 50 × 可安装性     verified-npm=1.0  verified-git=0.68  likely=0.4  related=0.16
      + 14 × 安装确定性   npm=14  git=7  manual=2
      + 14 × 活跃度       按最后推送分档：≤3天=14 ≤7天=12 ≤14天=10 ≤30天=7 ≤90天=4 ≤180天=2
      + 12 × 真实采用     npm 周下载量(≤6) + log(star)(≤3) + 已发 npm(3)
      + 10 × 完成度       README 长度、license、description、release
      +  8 × 维护信号     issue 关闭率、commit 数、有 fork
      −  惩罚            archived(−25) fork(−20) spam(−20) 一年未更新(−10) 无 license(−4)
                          同仓库兄弟包递减(−3×n，防 monorepo 霸榜)
```

## 安装

```sh
cd /path/to/dsh-plugin-market
pnpm install
pnpm build                                   # 产出 lib/ 与 lib/client.js
dsh plugin --profile web add /absolute/path/to/dsh-plugin-market
```

`dsh plugin` 会把包装进该 profile 并对账进 `dsh.profile.bundles` 层列表。

> 生效时机：`dsh plugin` 改的是 profile 的 `package.json`，**重启 dsh 服务后**这个插件本身才会加载。（它安装的其他插件则不需要重启。）

## 配置

| 字段 | 默认值 | 说明 |
|---|---|---|
| `registryUrl` | `''` | 已发布目录的 URL。为空时只用包内种子快照。仓库转公开后填 `https://raw.githubusercontent.com/NanmiCoder/dsh-plugin-market/main/data/v1/index.json`（`index.json` 已包含 UI 渲染所需的全部字段，体积约为 `catalog.json` 的四分之一；`catalog.json` 保留完整字段供审计） |
| `refreshIntervalHours` | `6` | 后台刷新间隔，`0` 关闭定时刷新 |
| `allowInstall` | `true` | 设为 `false` 后所有变更路由一律拒绝，退化为纯浏览 |
| `profileDir` | 由 `ctx.baseUrl` 推导 | 逃生阀，正常不需要设置 |

```yaml
- insert:
    - id: plugin-hub
      name: dsh-plugin-hub
      config:
        registryUrl: ''
        refreshIntervalHours: 6
        allowInstall: true
```

## 使用

启动 Web UI，打开「设置 → 插件市场」。默认只显示可一键安装的条目；搜索框支持仓库名、包名、标签与摘要。点安装会先弹确认框，列出仓库、star、许可证、npm 状态与是否需要执行构建脚本。

## 数据管线

```sh
GITHUB_TOKEN=$(gh auth token) node tools/crawler/cli.ts --no-llm            # 只跑规则，不花钱
GITHUB_TOKEN=$(gh auth token) DEEPSEEK_API_KEY=sk-… node tools/crawler/cli.ts
node tools/crawler/cli.ts --topic dsh-plugin --limit 60 --no-llm --dry-run  # 小样本，写 .tmp/
```

CI（`.github/workflows/crawl.yml`）每 2 小时跑一次，只在 `contentHash` 变化时提交。`contentHash` 刻意不含 `generatedAt`，否则每次都会产生一个无意义的 commit。

成本控制的枢纽是标签缓存键：它包含 README 哈希、manifest 摘要、描述与 topics，**但不含 `pushedAt`**——一个仓库连提 50 次代码却没动 README 和 manifest，就不会重复调用模型。`MAX_LLM_CALLS`（默认 300）是防止 prompt 改动导致一次性全量重标的闸门。

## 验证

### 0. 已真实验证

以下都在独立 profile（`hub-check`）与独立端口（3081）上实际跑过，未触碰运行中的实例：

- `pnpm typecheck`：host 与 client 两个 program 各 0 错误
- `pnpm build`：产出 `lib/` 与 `lib/client.js`（31.5 KB，closure-factory 协议正确）
- `node scripts/verify.mjs`：**64 项断言全部通过**（目录解析与前向护栏、安装白名单、请求信任栅栏、分级规则、标签校验、打分、缓存往返）
- `dsh --profile hub-check --dump-config`：组合树中出现 `id: plugin-hub` 及其 config
- 浏览器名册：`window.__DSH_BOOT__` 的 29 个条目中含 `dsh-plugin-hub`
- `GET /plugins/dsh-plugin-hub/client.js?rev=…` → **200**（31553 字节）
- `GET /plugin-hub/catalog` → 200，无远端数据时正确退化为 `source: "seed"`（路由前缀移出 `/plugins/*` 保留命名空间之后）
- 安全栅栏实测：同源 POST → 200；`sec-fetch-site: cross-site` → **403**；伪造 Origin → **403**；目录外的 id → 拒绝且**从未调用 pnpm**
- 采集管线实测：60 仓库样本分出 verified-npm 6 / verified-git 11 / likely 27 / related 17。**逐条复核：6 个 verified-npm 全部确实发布在 npm 且 manifest 带 `dsh.bundle`；抽查 6 个 verified-git 全部确实同时具备 `prepare` 与 `dsh.bundle`。**
- **真实浏览器端到端（ego-browser 驱动）**：
  - 设置面板出现「插件市场」导航项，点开后渲染 17 条卡片，带筛选、排序、搜索与来源提示
  - 通过 UI **真实安装** `dsh-file-claim`：pnpm 装到 `node_modules/`（v0.1.5）、`dependencies` 与 `dsh.profile.bundles` 均正确对账、卡片状态变为「已安装 v0.1.5」、按钮变为「卸载」
  - 确认弹窗正确展示仓库、Star、许可证、npm 包名与「会在你机器上执行它的代码」的风险提示
  - 通过 UI **真实卸载**：`dependencies`、`dsh.profile.bundles`、`node_modules/` 三处全部清理干净，卡片回到「未安装」
  - 截图存档：`/tmp/hub-market-open.png`（市场页）、`/tmp/hub-confirm.png`（确认弹窗）

### 1. 离线验证（不需要启动任何服务）

```sh
cd /path/to/dsh-plugin-market
pnpm typecheck
pnpm build
node scripts/verify.mjs                      # 应输出 all checks passed
dsh --profile hub-check --dump-config | grep -A4 "id: plugin-hub"
```

### 2. 端到端验证（需要启动服务，请自行安排时机）

```sh
cat > /tmp/hub-web.patch.yml <<'EOF'
- id: webserver
  config:
    host: 127.0.0.1
    port: 3081
EOF
dsh --profile hub-check --patch /tmp/hub-web.patch.yml
# 另开一个终端：
curl -s http://127.0.0.1:3081/plugin-hub/catalog | head -c 200
```

浏览器打开 `http://127.0.0.1:3081`，进入「设置 → 插件市场」，验证列表、搜索、确认框与安装后的刷新提示。

## 已知限制

- **pnpm 必须在 PATH 上**，否则安装返回退出码 127，UI 会提示"pnpm 不在 PATH"。
- **git 源插件安装时会执行仓库自带的构建脚本**，pnpm 还可能要求先在 profile 的 `pnpm-workspace.yaml` 里 `allowBuilds` 放行——这等于允许该包在你机器上执行代码，所以这个决定必须由你做，插件不会代劳。
- **带界面的插件装完要刷新页面**：浏览器端的 HMR 通道明确忽略插件图变更帧，新插件的 bundle 只会在下一次文档请求时进入名册。DSH 没有任何进程重启机制，所以这里只能提示刷新，不能承诺自动重启。
- **大模型打标尚未端到端验证**：本机没有 `DEEPSEEK_API_KEY`，打标逻辑目前只有单元级验证（schema 校验、README 裁剪、缓存键、失败降级）。配好 key 后请先用 `--limit 20 --dry-run` 抽检标签质量再放全量。
- **分级偏保守**：布局特殊的 monorepo 可能被降到 `likely-plugin`。宁可少标几个 verified，也不能让用户装到一个装不上的东西。
- **`related` 目前是兜底分级**：所有带 topic 但无 bundle 的仓库都会落在这里，包括蹭 topic 的无关项目。它们靠打分惩罚与大模型的 spam 判定沉底，且默认筛选是「可一键安装」，所以不会干扰主流程。
- **目录数据依赖仓库转公开**：`registryUrl` 现在默认为空（走包内种子），因为数据仓库仍是 private。转公开后只需改这一个默认值。
- **一次未能复现的异常**：某次通过 UI 卸载之后，独立实例的首页路由开始返回 400（插件自身的 `/plugin-hub/*` 路由仍正常 200），重启进程即恢复。之后用两个插件各跑两轮「路由安装 → 路由卸载」共 4 次，首页始终 200，**无法复现**；同一时刻另一个我从未接触过的实例（3080）也在返回 400 且至今如此，所以更可能是环境因素而非卸载路径。这里如实记录，尚未定位。若你遇到卸载后界面异常，重启 `dsh` 即可恢复。

## License

MIT
