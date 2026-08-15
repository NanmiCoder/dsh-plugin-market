# dsh-plugin-hub

DeepSeek Harness 的插件市场：在 Web UI 的「设置 → 插件市场」里浏览一份自动维护、逐条校验过的 DSH 插件目录，一键装进你正在运行的 profile，也能一键卸载。

- **Verified installable** —— 每个标记为「已验证」的条目都经过确定性校验，能真的装上，而不是"看起来像插件"。
- **不必重启** —— 安装后插件当场挂载进运行中的插件树；只有带界面的插件需要刷新页面。
- **自动更新的目录** —— 数据每 2 小时由 GitHub Actions 重新采集、清洗、打标并发布，插件端按 ETag 条件拉取，无需重装。
- **默认可解释的排序** —— 打分公式公开（见下），不是黑箱推荐。
- **安装前明确告知风险** —— 装第三方插件等于在你机器上执行它的代码，确认框会列出仓库、作者、许可证与是否需要执行构建脚本。

## 为什么需要它

GitHub 上 `dsh-plugin` topic 有 1300+ 个仓库，但按 star 倒序看到的前 50 个里，只有 16 个的根 `package.json` 带 `dsh` 字段——排在最前面的是 PicGo-Core、mcp-for-stata 这类蹭 topic 的无关项目。而 0 star 的分片里，抽样 50 个有 42 个是真插件。

本项目一次全量采集（`dsh-plugin` + `deepseek-harness` + `dsh` 三个 topic）的实际结果：**1886 个仓库 → 1984 条目录条目，其中 306 条可一键 npm 安装、145 条可从源码安装**，采集只花了 172 个 GraphQL point（额度 5000/小时），全部 1984 条经大模型打标。

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

数据流：**GitHub GraphQL + npm registry → 规则分级 → 大模型打标 → `data/v1/*.json` → 插件端 ETag 拉取 → 与本地已安装状态合并 → UI**。整条管线跑在你自己的机器上（本地定时任务），产物 commit + push 到 GitHub，没有任何一步依赖 CI。

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
| `registryUrl` | `''` | 目录来源。为空时按 **本仓库 `data/v1/catalog.json` → 本地缓存 → 包内种子** 依次回退：管线跑在本机，所以工作副本里天然有这份数据，不需要配置；而 npm 安装的包不含 `data/`，会落到种子。也可显式填 HTTPS URL、绝对路径或 `file://` URL。仓库转公开后填 `https://raw.githubusercontent.com/NanmiCoder/dsh-plugin-market/main/data/v1/index.json` 或 `catalog.json`，见下 |
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

启动 Web UI，打开「设置 → 插件市场」。默认只显示可一键安装的条目；搜索框覆盖仓库名、包名、分类、**仓库自己的 GitHub topics** 与模型标签。点安装会先弹确认框，列出仓库、star、许可证、npm 状态与是否需要执行构建脚本。

点任意一行进入详情页，展示：

- 仓库自己的 description，以及单独标注的模型摘要——两者不混排，因为一个是作者写的、一个是推断的
- **仓库自己的 GitHub topics**（可点击，直接转为搜索）与模型从受控词表选的标签，分区展示
- 完整仓库指标：star / fork / 提交数 / 开放与已关闭 issue / 开放 PR / 创建与更新时间 / 许可证 / 语言 / npm 版本 / 最新 release
- 安装命令，或不可自动安装时的克隆构建步骤
- **完整 README**，按需从 GitHub 拉取并渲染

### README 是怎么拿到和渲染的

README **不进目录文件**：1984 份 × 8 KB 会给浏览器每次打开都要解析的文档增加约 16 MB，而且内容只会和上次爬取一样旧。改为详情页打开时按需拉取（`GET /plugin-hub/readme?id=`），host 侧从**自己的目录**解析出 `owner/repo` 再去取——浏览器只传一个 id，所以这个路由无法被指向任意主机。

渲染器（`src/client/Markdown.tsx`）不使用 `dangerouslySetInnerHTML`，**每个节点都是 React 元素**，所以脚本注入在构造上就不可能，而不是靠过滤。链接与图片的 URL 另经 `safeUrl()` 只放行 http(s)（`javascript:`、`data:` 等一律丢弃）。

README 里常见的 HTML（居中 banner、`<h1>`、徽章）会先归一化成 Markdown 再渲染，否则会以字面文本显示——安全但没法看。代码围栏内的 HTML 原样保留。

## 数据管线

管线**完全跑在本机**，不部署到远程：

```sh
cp .env.example .env          # 填入 ANTHROPIC_API_KEY（.env 已 gitignore）
pnpm crawl:dry                # 全量跑但写 .tmp/，不碰 data/
node tools/crawler/cli.ts --topic dsh-plugin --limit 30   # 小样本调试；--limit 同样只写 .tmp/
pnpm crawl:rules              # 只跑规则，零模型开销
pnpm crawl                    # 完整：采集 + 分级 + 打标
pnpm refresh                  # 上面这条 + 有变化才 commit & push
```

### 收录作者的安装方式，但只执行规范化后的 spec

每个条目带两个不同的东西，**故意分开**：

| 字段 | 来源 | 会不会被执行 |
|---|---|---|
| `installMethod` / `installSpec` | 分级规则（看 npm registry、看有没有 `prepare`） | **会** |
| `installHint.method` / `installHint.command` | LLM 读 README 提取的 | **不会**，仅展示 |

README 是作者的自述，作者最清楚自己的项目怎么装；但 README 也可能错（包改名了、依赖了私有包、写了 `curl \| bash`）。所以：

1. **爬虫侧**：分级规则先定 `installSpec`——`verified-npm` 就是已验证存在于 registry 的包名，`verified-git` 就是 `github:owner/repo`。官方 `dsh plugin add` 本就是 pnpm 转发器，整个生态只有这两种安装语义。LLM 另从 README 提取作者写的命令存进 `installHint`，**只存，不执行**。
2. **host 侧**：安装只接受 `installSpec`，过 `isSafeSpec` 白名单后在 profile 目录跑 `pnpm add <spec>`，再 reconcile + 热挂载——与官方 CLI 同一机制。`installHint` 在安装路径上**完全不被读取**。
3. **UI**：详情页和确认框都同时显示「实际将执行 Y」和「作者写的是 X」。**两者不一致这件事本身就是信号** —— 说明 README 过时了，或者作者在推荐一条跑不通的路。

**为什么不逐字执行 README 命令**（2026-08-15 实测过的弯路）：对 3518 条条目审计发现，可安装的 936 条里 58% 的 README 根本没写命令；写了命令的里面 255 条带 shell 元字符（`&&`、`| bash`、多行），78 条是 `<profile>`、`<you>` 这类模板占位符，还有 `brew install`、`curl | bash` 等噪声。而 660 条 `dsh plugin --profile web add ...` 把 profile 名硬编码成了作者的——在别的 profile 里逐字执行会**装到作者的 profile 里去**，装完还报成功。规范化 spec 之后，这三类故障在构造上就不存在。

这样设计的代价是：有的插件作者确实写了正确的安装方式，但因为缺 `prepare` 或没发 npm，我们仍然只能给手动指引。这是**保守设计**，宁可少标 verified 也不能让用户装到崩。

### `index.json` 与 `catalog.json` 的取舍

`index.json` 是 `catalog.json` 去掉可推导字段（`url` 恒等于 `https://github.com/<repo>`；`manualSteps` 是固定的克隆构建配方）后的版本。**它现在只比 `catalog.json` 小约 11%**（详情页要读的字段几乎和完整条目一样多），所以两者都可以填给 `registryUrl`，差别不大。

> README 之前写的"约四分之一"是错的——加字段之前实测就已经是 68%。
>
> 更要紧的是：这个子集是**手工维护**的。从里面漏掉一个字段不会让构建失败、也不会让类型检查报错，只会让线上用户的详情页少一行指标——我就是这么发现 `topics` 和另外 10 个字段没被带上的。`scripts/verify.mjs` 现在拿 UI 实际读取的字段列表去断言 `index.json`，防止再次静默漂移。
>
> 顺带一提：浏览器拿到的始终是 host `/catalog` 路由拼出的完整条目，`index.json` 只省 host 每 6 小时一次的那个带 ETag 的请求。真嫌它维护成本高的话，直接指向 `catalog.json`、删掉 `index.json` 也是合理的。

### 两套标签，不合并

目录里每条同时带 `topics` 与 `tags`，UI 也分区展示：

| 字段 | 来源 | 用途 |
|---|---|---|
| `topics` | **仓库自己打的 GitHub topics**，原样透传 | 作者的自述。不改写、不过滤 |
| `tags` | 模型从**受控词表**里选 | 全目录可比，因此能当筛选条件用 |

分开是有意的：受控词表让标签在 1984 条之间可比，但代价是丢掉了作者的原话；topics 保留原话，但每个仓库各写各的、无法横向比较。两者回答的不是同一个问题，混在一起两个都会变差。

> 这里修过一个 bug：`repositoryTopics` 一直在抓（`github.ts`），分级和打标 prompt 也一直在读，但 **`CatalogEntry` 里没有这个字段**，所以从未进过产物——UI 上看到的"标签"全是模型推断的，仓库自己打的话题一个都没显示。

### 分片：一个 slice 只能有一个 `created:` 限定符

GitHub search 单次查询最多返回 1000 条，所以按 star 桶 + 创建日期递归二分。**同一个查询里重复出现 `created:` 限定符时，GitHub 只认其中一个，不会取交集**——原来的实现是往查询后面追加 `created:<X`，于是每一层"分裂"出来的子查询实际范围和父查询一样：

```
# 错的：4 个 created:，实际只有 1 个生效
topic:dsh-plugin stars:1..2 created:>=2025-10-23 created:<2026-03-19 created:<2026-01-05 created:<2025-11-29

# 对的：一个区间
topic:dsh-plugin stars:1..2 created:2025-11-10..2025-11-19
```

症状很好认：每个分片都声称有 ~900 条，但跑完总数只涨 2 条——因为它们返回的是同一批前 1000 条，其余的谁也没取到。修完之后 `topic:dsh-plugin` 从 **38 个分片（多个被截断）** 变成 **15 个分片（0 个被截断）**。

`scripts/verify.mjs` 现在断言：每个 slice 恰好一个 `created:`、窗口两端都收敛、同桶内窗口不重叠、有数据的区间不留空洞。

### 打标用的是 Anthropic 官方 SDK

`tools/crawler/label.ts` 用 `@anthropic-ai/sdk`。它连哪个端点由 `LLM_BASE_URL` 决定：

| key 类型 | `LLM_BASE_URL` | 实际模型 |
|---|---|---|
| DeepSeek key（默认） | `https://api.deepseek.com/anthropic` | `deepseek-v4-flash` |
| 真 `sk-ant-…` key | `https://api.anthropic.com` | 改 `LLM_MODEL` 为 `claude-opus-5` 等 |

> 实测：同一把 DeepSeek key 在 `api.anthropic.com` 返回 403，在 DeepSeek 的 Anthropic 兼容端点返回 200。兼容端点还会把 Claude 模型名映射过去（`claude-opus-5` → `deepseek-v4-pro`），但打标是批量分类任务，显式用 flash 档更合适也更省。

> **环境变量陷阱**：Anthropic SDK 读 `ANTHROPIC_AUTH_TOKEN` 的优先级高于 `ANTHROPIC_API_KEY`。如果你的 shell 里也 export 了 Kimi 等其他 Anthropic 兼容服务的 token（`ANTHROPIC_AUTH_TOKEN=...` + `ANTHROPIC_BASE_URL=...`），爬虫会**静默用错 key**，报 401 且错误信息里的 key 尾巴和你配的对不上。`loadDotEnv()` 会在读 `.env` 前先删掉这两个变量，保证 `.env` 是唯一来源。

**结构化输出走工具调用，不是让模型"输出 JSON"。** 这里踩过两个实测的坑：

1. `output_config.format`（Anthropic 结构化输出）在这个端点上**返回 200 但不生效** —— 我指定 `{category}`，它返回了完全不相干的字段。不能依赖。
2. 强制 `tool_choice` 在 thinking 开启时被拒（`Thinking mode does not support this tool_choice`），所以显式 `thinking: {type:'disabled'}`。分类任务本来也不需要推理，省下的 thinking token 是成本大头。

于是：**声明一个 `emit_label` 工具，用 `tool_choice` 强制调用，工具的 `input_schema` 就是输出契约**。这是 Messages API 保证输出形状的正规方式。

标签校验分两档严重性：摘要缺失或分类不可用 → 该条降级；**模型编造的标签只丢弃标签本身，不作废整条分类**（标签是次要筛选维度，为一个瞎编的 tag 废掉一条好分类得不偿失）。被丢弃的标签会打日志——某个反复出现的词就是下次扩词表的候选。实测这一改把降级率从 25% 降到 0。

### 成本控制

枢纽是标签缓存键：它包含 README 哈希、manifest 摘要、描述与 topics，**但不含 `pushedAt`**——一个仓库连提 50 次代码却没动 README 和 manifest，就不会重复调用模型。`MAX_LLM_CALLS`（默认 300）是防止 prompt 改动导致一次性全量重标的闸门，首次全量需要 `--force` 显式越过。

静态 system prompt 与工具 schema 在每次请求中字节一致，端点的前缀缓存因此生效：实测 20 条一批，输入 token 从 22172 降到 3521。

### 本地定时任务

```sh
cp scripts/com.nanmicoder.dsh-plugin-hub.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.nanmicoder.dsh-plugin-hub.plist
launchctl start com.nanmicoder.dsh-plugin-hub    # 立刻跑一次
```

每 2 小时跑一次 `scripts/refresh.sh`：只在 `contentHash` 变化时 commit（`contentHash` 刻意不含 `generatedAt`，否则每次都产生无意义 commit），push 失败只留本地 commit、下次自动带上。日志在 `.logs/`，保留最近 50 份。

launchd 在机器睡眠期间不补跑、醒来后跑一次 —— 笔记本合盖过夜后开盖即刷新，正是想要的行为。

## 验证

### 0. 已真实验证

以下都在独立 profile（`hub-check`）与独立端口（3081）上实际跑过，未触碰运行中的实例：

- `pnpm typecheck`：host 与 client 两个 program 各 0 错误
- `pnpm build`：产出 `lib/` 与 `lib/client.js`（31.5 KB，closure-factory 协议正确）
- `node scripts/verify.mjs`：**64 项断言全部通过**（目录解析与前向护栏、安装白名单、请求信任栅栏、分级规则、标签校验、打分、缓存往返）
- `dsh --profile hub-check --dump-config`：组合树中出现 `id: plugin-hub` 及其 config
- **大模型打标全量跑通**（Anthropic SDK → DeepSeek 兼容端点，`deepseek-v4-flash`）：**1984 条调用、5 条降级（0.25%）**，191 万输入 / 37 万输出 token；100% 条目带中英文摘要。降级的 5 条是模型偶发漏填摘要，重试同一条即成功
- **词表漂移可观测**：507 条出现越界值，全部被纠正而非丢弃。统计后发现前几名（`agent-orchestration`/`ui-experience`/`security`）其实是模型把分类名当标签用，而 `settings`/`vision`/`documentation` 与分类 `plugin-manager`/`memory` 是真正该补的词条
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
- **分级偏保守**：布局特殊的 monorepo 可能被降到 `likely-plugin`。宁可少标几个 verified，也不能让用户装到一个装不上的东西。
- **`related` 目前是兜底分级**：所有带 topic 但无 bundle 的仓库都会落在这里，包括蹭 topic 的无关项目。它们靠打分惩罚与大模型的 spam 判定沉底，且默认筛选是「可一键安装」，所以不会干扰主流程。
- **目录数据依赖仓库转公开**：`registryUrl` 现在默认为空（走包内种子），因为数据仓库仍是 private。转公开后只需改这一个默认值。
- **一次未能复现的异常**：某次通过 UI 卸载之后，独立实例的首页路由开始返回 400（插件自身的 `/plugin-hub/*` 路由仍正常 200），重启进程即恢复。之后用两个插件各跑两轮「路由安装 → 路由卸载」共 4 次，首页始终 200，**无法复现**；同一时刻另一个我从未接触过的实例（3080）也在返回 400 且至今如此，所以更可能是环境因素而非卸载路径。这里如实记录，尚未定位。若你遇到卸载后界面异常，重启 `dsh` 即可恢复。

## License

MIT
