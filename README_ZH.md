<p align="right">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="dsh-plugin-market 把发现到的 DSH 仓库整理成带安全安装 spec 的可信插件目录">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@nanmicoder/dsh-plugin-market"><img src="https://img.shields.io/npm/v/@nanmicoder/dsh-plugin-market.svg" alt="npm 版本"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@nanmicoder/dsh-plugin-market.svg" alt="MIT 许可证"></a>
  <img src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-202724" alt="DeepSeek Harness 插件">
</p>

## 找到真插件，只安装能验证的插件

`dsh-plugin-market` 为 DeepSeek Harness 加入内置插件市场。你可以在 **设置 → 插件市场** 中浏览持续维护的目录、检查每条收录背后的证据，并直接安装或卸载已验证插件。

目录刻意采取保守策略：只有确定性规则能决定一个产物是否可安装；模型生成的摘要和标签只用于展示，永远不能授权安装。

### 当前目录证据

仓库中 2026-08-15 生成的目录快照包含：

| 目录条目 | 可一键安装 | npm 已验证 | 源码已验证 |
| ---: | ---: | ---: | ---: |
| **3,518** | **936** | **716** | **220** |

每次一键安装执行的都是目录内规范化后的 package spec，而不是从仓库 README 复制来的 shell 命令。

## 为什么需要 Plugin Market？

| 能力 | 带来的变化 |
| --- | --- |
| **可验证的安装路径** | 只有 npm manifest、DSH bundle 元数据、patch 文件和构建条件都满足时，条目才会变成可安装。 |
| **发现长尾插件** | 可同时搜索仓库名、包名、分类、作者 topics 和受控目录标签，不必只靠 star 排序。 |
| **结果可解释** | 仓库描述、模型摘要、topics、指标、许可证、release 和安装证据彼此分开展示。 |
| **构造上安全的输入** | 浏览器只发送目录 ID；host 再解析并校验精确的 npm 或 GitHub spec，之后才调用 pnpm。 |
| **即时运行时反馈** | 纯 host 插件安装后直接热挂载；带 Web UI 的插件只需刷新页面。 |

## 安装

> [!NOTE]
> 使用前请确保已安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

### npm

```sh
dsh plugin --profile web add @nanmicoder/dsh-plugin-market
```

检查组合配置、重启 DSH，然后打开 Web UI：

```sh
dsh --profile web --dump-config
dsh web
```

接着进入 **设置 → 插件市场**。

### 从源码构建

```sh
git clone https://github.com/NanmiCoder/dsh-plugin-market.git
cd dsh-plugin-market
pnpm install
pnpm build
dsh plugin --profile web add .
```

修改源码后请重新执行 `pnpm build`。本地安装会继续链接到当前源码目录。

## 工作方式

1. 爬虫从 `dsh-plugin`、`deepseek-harness` 和 `dsh` 三个 GitHub topic 发现仓库。
2. 收集 GitHub 元数据、根目录和 workspace manifest、patch 文件、README、release 与 npm registry manifest。
3. 确定性规则给条目分配四种信任等级之一，并推导唯一允许执行的 spec。
4. 模型只补充简短摘要、分类、标签与作者自述的安装提示；这些字段不会改变分级和可执行 spec。
5. 带版本的目录产物发布在 `data/v1/`；插件使用 ETag 刷新，并保留本地缓存。
6. Web UI 把目录条目与当前 profile 的已安装状态合并；安装时只把条目 ID 发回 host。
7. host 从自己的目录查找该 ID，校验规范化 spec，执行 `pnpm add`，对账 `dsh.profile.bundles`，最后热挂载插件行。

## 信任模型

| 分级 | 必须满足的证据 | 市场行为 |
| --- | --- | --- |
| `verified-npm` | npm registry manifest 声明了 `dsh.bundle`。 | 使用精确的已发布包名一键安装。 |
| `verified-git` | 仓库声明 `dsh.bundle`，包含合法 `cordis.patch.yml`，且 Git 安装期间能够构建。 | 使用 `github:owner/repo` 一键安装，并明确警告会执行构建脚本。 |
| `likely-plugin` | 存在插件特征，但无法证明能无人值守安装。 | 只浏览，并提供手动 clone/build 步骤。 |
| `related` | 生态相关项目，但没有可挂载的 DSH bundle。 | 只浏览。 |

### README 提示是证据，不是命令

每条记录刻意分开保存两种值：

| 字段 | 来源 | 会不会执行 |
| --- | --- | --- |
| `installSpec` | 确定性的 npm/Git 分类规则 | **会**，但必须先通过 host 安全门 |
| `installHint.command` | 模型从作者 README 提取 | **不会**，只展示 |

因此，README 中硬编码的 profile 名、模板占位符、shell 元字符和过期包名都无法进入执行路径。

## 市场体验

- 按「可一键安装」「全部」「已安装」筛选。
- 搜索仓库名、包名、topics、分类和受控标签。
- 打开详情面板查看完整仓库指标、安装证据和源 README。
- 确认前明确看到市场真正会执行的命令。
- 不手改 manifest，即可对当前 profile 安装、卸载并完成对账。
- 使用 `allowInstall: false` 把市场切换为纯浏览模式。

README 通过目录 ID 路由按需拉取。渲染器构造 React 元素，不使用 `dangerouslySetInnerHTML`；链接和图片仅允许安全的 HTTP(S) URL。

## 配置

| 字段 | 默认值 | 作用 |
| --- | --- | --- |
| `registryUrl` | `''` | 目录来源。依次回退到仓库 `data/v1/catalog.json`、本地缓存和包内种子。npm 安装通常先使用种子，直到配置远程 URL。 |
| `refreshIntervalHours` | `6` | 后台刷新间隔；设为 `0` 可关闭定时刷新。 |
| `allowInstall` | `true` | 设为 `false` 后拒绝所有安装/卸载请求，只保留浏览。 |
| `profileDir` | 从 `ctx.baseUrl` 推导 | 非标准 profile 布局的逃生阀，正常无需填写。 |

```yaml
- insert:
    - id: plugin-hub
      name: dsh-plugin-hub
      config:
        registryUrl: ''
        refreshIntervalHours: 6
        allowInstall: true
```

## 使用边界

- 安装第三方插件等于在你的机器上执行第三方代码。任何变更前，确认框都会展示仓库、作者、许可证、包来源和构建脚本风险。
- 确定性验证能证明打包与可安装性，不能证明第三方插件一定无害；不熟悉的代码仍应先审查。
- npm 包只包含小型种子目录，不包含数 MB 的实时数据；如需独立发布的实时目录，请配置 `registryUrl`。
- host 路由使用 `/plugin-hub/*`，不会占用专供 client bundle 的 `/plugins/dsh-plugin-hub`。
- UI 注册在 `settings.section`，兼容未提供 `settings.plugins.tab` 的 DSH 构建。

## 目录开发

```sh
cp .env.example .env          # 模型标签需要 ANTHROPIC_API_KEY
pnpm crawl:dry                # 全量爬取到 .tmp/，不修改 data/
pnpm crawl:rules              # 只跑确定性分类
pnpm crawl                    # 爬取、分类并打标
pnpm refresh                  # 仅在内容变化时刷新并推送
```

安装提示通过 Anthropic SDK 提取。默认 DeepSeek 兼容端点与模型可使用 `LLM_BASE_URL` 和 `LLM_MODEL` 覆盖；无论模型 Provider 如何变化，分级始终只由规则决定。

## 开发

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm verify
npm pack --dry-run --ignore-scripts
```

`pnpm verify` 会离线检查目录、安装安全门、请求信任、爬虫、模型标签、产物和 npm 包契约。

## 发版

普通 commit 和 push 不会发布 npm。发版 tag 必须与 `package.json` 完全一致：

```sh
pnpm version patch --no-git-tag-version
git add package.json pnpm-lock.yaml
git commit -m "chore: release v$(node -p \"require('./package.json').version\")"
git push origin main
git tag "v$(node -p \"require('./package.json').version\")"
git push origin --tags
```

`publish.yml` 会从源码重新构建、校验包与 tarball，再通过 npm Trusted Publishing（OIDC）发布，不需要长期保存 `NPM_TOKEN`。

## 许可证

[MIT](./LICENSE)
