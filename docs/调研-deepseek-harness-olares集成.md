# 调研：DeepSeek Harness 内核 + WorkBuddy 级 UI（Olares Chat）

> 状态：调研完成；**UI 主壳决策已切换为 dsh web（2026-08-14）**  
> 内核参考：`_参考/deepseek-harness`（`@deepseek-ai/dsh` `0.1.0-rc.6`）  
> UI 主壳：官方 `dsh-base` + `dsh-web-app`（slots）；WorkBuddy 5.3.8 仅交互参考  
> Olares 接入对照：`/Users/luolong/Desktop/test_lares`（**仅** Router / olares-cli 语义参考；**不再**采用 pi-web）  
> 目标环境：机器 1（`luolong01`，默认热更新）

---

## 0. 已决策：走 dsh UI 主壳（覆盖下文旧「路径 A」）

**现行产品面：**

1. **彻底脱离 pi / pi-web**。
2. **运行时内核 = DeepSeek Harness（dsh）**。
3. **UI 主壳 = 官方 dsh web**（`ui-layout` 三栏 + client roster）；通过 `@dina/bundle-web` patch、`@dina/client-dina` inject、profile `dsh plugin add` 接入生态（如 `dsh-better-sidebar`）。
4. **WorkBuddy = 参考面**——交互密度与习惯靠拢，**不再**维护平行 SPA 信息架构，也**不再**推荐「独立 SPA + Host RPC」作为产品壳。

下文 §7.4「路径 A / WorkBuddy-shell 唯一 SPA」为历史调研结论，**以本节为准**。

落地姿势：

1. Profile `dina-web`：`dsh-base` + `dsh-web-app` + `@dina/bundle-web`；
2. Host overlay：Olares Router LLM shim、skills、workspace、permission；
3. Client：默认 upstream `ui-*` + 少量 Dina inject；社区插件经 profile 安装；
4. Chart / Docker 入口改为 dsh web boot（端口 8080）。

**Router / olares-cli 仍按 Host 侧嵌入**；与 UI slots 解耦。

---

## 1. 结论摘要（历史；已被 §0 覆盖）

**原产品铁律（调研期）：**

1. **彻底脱离 pi / pi-web**——pi 只作历史对照，不进依赖、不做壳、不做迁移兼容。
2. **运行时内核 = DeepSeek Harness（dsh）**——agent loop、LLM、工具、skills、会话、沙箱。
3. **产品 UI = 一比一复刻 WorkBuddy**——已被 §0 修订为「dsh UI 主壳 + WorkBuddy 参考」。

原落地姿势中的「自研 WorkBuddy-shell 唯一 SPA」**已废弃**；见 §0。

---



## 2. DeepSeek Harness 是什么


| 项    | 内容                                                                        |
| ---- | ------------------------------------------------------------------------- |
| 定位   | 开源 agent harness（开发者预览，承诺破坏性变更）                                           |
| 运行入口 | `npx @deepseek-ai/dsh web` / 源码 `pnpm dsh web`，默认 `http://127.0.0.1:3080` |
| 框架   | Vendored Cordis（一切皆插件，注册可逆）                                               |
| Node | `^22.19.0 || >=24`，包管理 `pnpm@11.7.0`                                      |
| 结构   | `packages/*/*` 工作区 + `apps/cli`（`dsh` bin）+ `apps/web` + `vendor/` Cordis |


dsh 自带 Host（Node HTTP + Typert RPC）与默认 Client（Vite SPA）。**Dina 保留 Host 能力，替换默认 Client 产品壳为 WorkBuddy 复刻版。** 浏览器仍不直连 Router。

---

## 2.1 已否决的方案

| 方案 | 结论 |
|---|---|
| 继续用 pi-web / pi-coding-agent 做 UI | **否决**——完全脱离 |
| 直接使用 / 换皮 `dsh-web-app` 默认 Chat | **否决**——与 WorkBuddy 布局/交互不一致 |
| 把 WorkBuddy `app.asar` 源码拷进仓库 | **否决**——专有二进制；只允许观摩交互与自研复刻 |
| 平行再做一个 Vue/UniApp 壳 | **否决**——单一 Web 壳 |

---



## 3. 「一切皆插件」：必须掌握的概念



### 3.1 Cordis 五件套

1. **插件**：导出 `name` / `inject` / `apply(ctx)`（或 `Service` 子类）
2. **上下文**：稳定服务键 `ctx.llm`、`ctx.tools`、`ctx.sessions`、`ctx.skills`…
3. **inject**：声明服务依赖，由框架排队启动，不手写启动序
4. **类型化事件**：`emit` / `waterfall` / `parallel` / `serial`
5. **可逆副作用**：`ctx.effect()` / `ctx.on()`；卸载即撤销注册

Waterfall 是环绕中间件：监听器收 `(…args, next)`，可改写后委托，也可短路。agent 请求、LLM 流、工具执行都靠它扩展，而不是改 loop 源码。

### 3.2 Profile 与 Bundle（分发面）

运行中的 dsh = 空配置上叠加的多层 patch：

```
profile.bundles[] 中每个组合包的 cordis.patch.yml
  → profile 自己的 cordis.patch.yml
  → $DSH_HOME/cordis.patch.yml
  → 命令行 --patch overlay
```


| 概念             | 回答的问题         | Manifest                                             |
| -------------- | ------------- | ---------------------------------------------------- |
| **组合包 bundle** | 这个包贡献什么配置层？   | `package.json` → `dsh.bundle.patch`                  |
| **profile**    | 启动时按什么顺序叠哪些包？ | `$DSH_HOME/profiles/<name>/` → `dsh.profile.bundles` |


发行自带模板：

- `dsh-base`：LLM、工具、会话、沙箱、设置、凭据、telemetry…
- `dsh-web-app`：Web 服务器、前端静态资源、浏览器 client 插件花名册
- `dsh-headless`：无服务器一次性 runner

安装树外插件：`dsh plugin --profile <name> add <pkg|path|github:…>`。

**对 Dina 的含义：** 我们应交付一个或多个 `dsh-olares-`* / `@dina/*` bundle，而不是改 `dsh-base` 源码。

### 3.3 能力 Seam（可替换能力的单位）

一个 **seam** = Service Definition（`ctx.<key>`）+ Provider + Consumer。任一角色单独都不叫 seam。

规范范例（Bash）：

```
dsh-shell（定义） ← dsh-bash-local（提供方）
                 ← dsh-tool-bash（消费方/工具）
```

换提供方（如 E2B）时，工具与定义可不动。这是把 Olares 能力「嵌进体系」时应对齐的拆分法。

### 3.4 一轮对话怎么走（扩展点地图）

```
turn/start
  claim inbox → agent/pre-step (waterfall)
  step/start → 组装 system prompt + tool schemas
  agent/request → llm/stream → assistant/chunk* → assistant/message
  tool/call → tools/pre-execute → tools/execute → tools/post-execute → tool/result
  step/end →（可能多步）
  agent/turn-stopping
turn/end
```

持久事实进会话日志（`SessionEvent`）；实时协调走 `agent/*`。  
**模型可见即已记录**：任何进模型的内容都必须能从日志重建。

### 3.5 工具流水线（策略不进工具体）

`pre-execute`（权限/钩子）→ 单调 guard → `execute`（超时/重试包装）→ 工具 `execute()` → `post-execute` → `finalizeContent` → `tools/result`。

工具需同时设计 **模型可见 render** 与 **UI 卡片**（`presentCall` / `presentResult`：`generic` / `terminal` / `diff` / `search` / `web`）。

### 3.6 Skill（与 olares-cli Skills 高度同构）


| 层       | 包                      | 职责                   |
| ------- | ---------------------- | -------------------- |
| 注册表     | `dsh-skill`            | `ctx.skills`，不知来源    |
| 文件系统提供方 | `dsh-skill-filesystem` | 扫 `SKILL.md` / 平铺 md |
| 模型消费    | `dsh-tool-skill`       | 目录注入 + `skill` 工具    |


发现根（rank 升序，数字越大越「远」）：

- 100 `.dsh/skills`
- 200 `.agents/skills`
- 300 `customSkillDirs`
- 400 `~/.dsh/skills`
- 500 `~/.agents/skills`

格式与 Cursor/olares skills 一致：`<name>/SKILL.md` + frontmatter（`name`/`description`/调用策略）。  
另有 `ctx.skills.register()` 运行时嵌入 skill。

### 3.7 LLM Seam

- `ctx.llm.registerAdapter(providers, adapter)`：一路由一适配器
- 协议：`StreamChunk`（usage 先于 finish；工具参数保持原始 JSON 字符串）
- 两个官方适配器：
  - `dsh-llm-deepseek`：直连 HTTP + SSE
  - `dsh-llm-pi-ai`：基于 `@earendil-works/pi-ai`，**显式支持手写 OpenAI 兼容网关**（`api: openai-completions` + `baseURL` + `models[]`）
- 凭据：配置只写 `apiKeyEnv` 引用；值在 `ctx.credentials`；按请求解析
- 动态发现：`ctx.llm.discoverModels` / `registerModelDiscovery`（OpenAI `/models` 形态）

`llm-pi-ai` 的 `headers` 可附加自定义请求头，但文档警告：headers 里的密钥会进脱敏不全的描述面——机密仍应走 `apiKeyEnv`。

### 3.8 Host / Client 与 UI 插件

- Host：`webserver`（只允许 `127.0.0.1` 或 `0.0.0.0`）+ `frontend-static` + `apiproxy` / Typert RPC
- Client：`packages/client/ui-*` 各自是 Cordis client 插件（对话、模型设置、skills、侧栏、goal…）
- 扩展 Chat 行：注册 `ConversationNodeDefinition` + keyed renderer（见 cookbook）
- 自指扩展：`ui-cordis` / `tool-cordis` / `cordis-host-runner`（动态挂载插件，权限等同 shell）

**Web 服务器本身不做认证**；Olares 入口 `authLevel: private` 是外层闸门。

### 3.9 新行为归属速查


| 目标           | 机制                                           |
| ------------ | -------------------------------------------- |
| 新模型提供方       | `ctx.llm.registerAdapter` 或配置 `llm-pi-ai` 路由 |
| 新面向模型能力      | `ctx.tools.register(defineTool(…))`          |
| 平台操作指引       | `ctx.skills` 提供方 / 文件系统 SKILL.md             |
| Shell 环境注入   | `ctx.shellEnv.register`                      |
| 拦截请求/工具      | `agent/*` / `tools/*` waterfall              |
| 新 UI Chat 节点 | Conversation Node + client renderer          |
| 设置页          | client `ui-settings-*` 或现有 Models 页配置        |
| 分发           | 自有 bundle + `dsh plugin add` / 镜像内置 profile  |


---



## 4. test_lares（Jarvis）对照：我们已有的 Olares 接入

Jarvis 在 pi-web 上的接入点（应迁移语义，而非迁移壳）：


| 能力         | 实现位置                                          | 行为                                                                                               |
| ---------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Router 数据面 | `lib/olares/shim.ts` + `app/llm/v1/[...path]` | 浏览器/pi → 本机 `/llm/v1` → `LLM_GATEWAY_URL`；剥离 placeholder Authorization；无 sk- 时发 `x-caller-appid` |
| 启动引导       | `bootstrap.ts` + `instrumentation.ts`         | 拉 Router `/models`，写入 `models.json` 的 `olares` provider；默认模型；seed skills                         |
| 边缘身份       | `identity.ts`                                 | 从 `remote-user` / `auth_token` cookie 等解析用户                                                      |
| CLI 鉴权物化   | `ensureCliProfile`                            | 每用户 HOME + `.olares-cli` + file keychain（仅 access token，无 refresh）                               |
| 会话绑定       | `session-identity.ts`                         | agent 创建时 `rememberSessionIdentity`，把 CLI env 写进 `process.env`                                   |
| CLI 执行     | `cli.ts`                                      | `spawn('olares-cli', …)` + 超时                                                                    |
| Skills     | `app/olares_cli/skills/*`                     | 整套 olares-* SKILL.md 拷到 agent skills 目录                                                          |
| 镜像         | Dockerfile                                    | Node 22 + 全局 `@olares/cli@1.12.7-cli.0` + `/data/*`                                              |
| Chart      | `deploy/jarvis`                               | 依赖 `router`；`apiTimeout: 0`；入口 8080                                                              |


**关键不变量（迁到 dsh 后仍必须成立）：**

1. 集群内零配置：优先 `x-caller-appid: <OLARES_APP_ID>`，可选 `DINA_ROUTER_API_KEY` / `JARVIS_ROUTER_API_KEY`。
2. 模型客户端常强制带 `Authorization`；与 Router 零配置路径冲突时，需要 **shim 或原生适配器** 消解。
3. olares-cli 冷路径必须带 **边缘用户身份**；Olares 应用 pod 通常 per-user，但仍应按用户物化 profile。
4. Skills 是「教模型何时/如何调 CLI」；真正执行多走 bash/spawn。

---



## 5. 嵌入点设计：Router → 插件



### 5.1 三条候选路径


| 方案                                      | 做法                                                                                                                                         | 优点                        | 缺点                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------- |
| **A. 配置型（优先试）**                         | 用现成 `dsh-llm-pi-ai` 声明 `olares` 路由：`api: openai-completions`，`baseURL: $LLM_GATEWAY_URL`，`discoverModels` 同步目录；默认模型改 `agent-default-model` | 零自研适配器；吃满官方 Models 设置页与发现 | 鉴权：pi-ai OpenAI 实现仍要 key/Authorization；`x-caller-appid` 需靠 `headers` + 占位 `apiKeyEnv`，或仍要 shim |
| **B. Shim 插件（与 Jarvis 同构）**             | Host 插件 `register` `/llm/v1/`*，内部复用 Jarvis `proxyToRouter`；pi-ai `baseURL` 指 `http://127.0.0.1:<port>/llm/v1`                              | 鉴权语义已验证；适配器无感             | 多一跳；要保证只本机可达；略「非原生」                                                                            |
| **C. 原生** `dsh-llm-olares` **适配器（中长期）** | 自研 `LlmAdapter`：fetch Router SSE，原生发 `x-caller-appid` / Bearer，实现 `listModels`/`resolveModel`/`discoverModels`                             | 最贴 seam；可控重试/错误码/归因头      | 工作量大；要跟进 StreamChunk 约定与测试策略                                                                   |




### 5.2 推荐组合

**落地第一期：B（薄 shim 插件）+ A（pi-ai 路由指向 shim）**  
原因：最快复用 `test_lares` 已验证的鉴权，同时仍表现为「LLM 插件配置」，不污染 agent loop。

**第二期：评估 C**，若 Router 方言/错误分类/无 Authorization 路径成为包袱，再收拢为单一适配器，shim 可删。

配套插件建议：

```
@dina/llm-olares-shim          # Host：/llm/v1 代理 + 可选启动时 discover 写入 settings
@dina/bundle-olares            # cordis.patch：插入 shim；patch llm-pi-ai / agent-default-model
```

`agent-default-model` 在 base 默认是 `deepseek-official / deepseek-v4-flash`，Olares 包必须覆盖为 `olares / <catalog-first-chat-model>`。

DeepSeek 官方 onboarding（Models 页首次填 DeepSeek key）在 Olares 场景应 **跳过或短路**：只要 `olares` 路由可用即视为就绪（可用 client 插件或 settings 预置）。

### 5.3 环境变量映射


| Dina / Jarvis         | dsh 侧落点                                      |
| --------------------- | -------------------------------------------- |
| `LLM_GATEWAY_URL`     | shim 上游；或 pi-ai `baseURL`                    |
| `OLARES_APP_ID`       | shim → `x-caller-appid`                      |
| `DINA_ROUTER_API_KEY` | shim Bearer；或 credentials 引用                 |
| `PI_DEFAULT_MODEL`    | patch `agent-default-model` / settings       |
| `PORT` / `HOSTNAME`   | `webserver` `port`/`host`（集群必须 `0.0.0.0`）    |
| （新）`DSH_HOME`         | `/data/dsh`（会话、settings、credentials、profile） |


---



## 6. 嵌入点设计：olares-cli → 插件



### 6.1 能力分层（按 seam 思维）

不要做成「一个超级 Olares 插件」。建议拆：


| 角色                        | 包（建议名）                       | 做什么                                                                                                                     |
| ------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Identity Provider**     | `@dina/olares-identity`      | 从入口请求头解析边缘身份；物化 per-user CLI profile（移植 `identity.ts` / `ensureCliProfile`）                                             |
| **ShellEnv Contributor**  | 同上或 `@dina/olares-shell-env` | `ctx.shellEnv.register`：注入 `HOME`/`OLARES_CLI_HOME`/`OLARES_CLI_DATA_DIR`/`OLARES_CLI_REMOTE_ONLY` 等，使 **bash 工具**自动带身份 |
| **Skill Provider / Seed** | `@dina/olares-skills`        | `customSkillDirs` 指向镜像内 `olares_cli/skills`，或启动时 seed 到 `$DSH_HOME/skills`；格式已兼容 `dsh-skill-filesystem`                 |
| **可选 Tool Consumer**      | `@dina/tool-olares-cli`（后期）  | 对高频、需结构化输出的操作（如 `market status`）做 `defineTool`，UI 用 `terminal`/`generic` 卡                                              |
| **可选 Service Definition** | `@dina/olares-cli` seam（后期）  | `ctx.olaresCli.run(args)`，供多个 Consumer 复用，避免到处 spawn                                                                    |




### 6.2 与 Jarvis 路径的对应关系


| Jarvis                              | dsh                                                           |
| ----------------------------------- | ------------------------------------------------------------- |
| `seedOlaresSkills(agentDir)`        | skill-filesystem `customSkillDirs` 或 seed 到 `dshHome/skills`  |
| agent 路由里 `rememberSessionIdentity` | Host connection / apiproxy 中间件：会话创建或首包请求时绑定身份；再 `shellEnv` 解析 |
| `spawnOlaresCli`                    | 优先：模型调 bash → `olares-cli …`（skills 已教）；结构化需求再上专用 tool        |
| 全局 `process.env` 注入                 | **避免**；改用 `shellEnv` 每调用快照（dsh 明确禁止继承脏 `DSH_`*，同理勿污染进程环境）     |




### 6.3 Skills 是否够用？

**第一期够用。** olares-* 技能树已经是「面向模型的操作手册 + CLI 约定」；dsh 的 `skill` 工具会把正文注入上下文，模型再经 bash 执行——与 Jarvis 心智模型一致。

何时升专用 Tool：

- 需要稳定 JSON schema 给 Code Mode / 下游工具链；
- 需要审批门（`ctx.approval`）或与会话事件（Conversation Node）强绑定；
- bash 输出噪声导致模型不稳定。



### 6.4 镜像依赖

继续在镜像内安装 `@olares/cli@1.12.7-cli.0`（与 Jarvis/Dina Dockerfile 一致），保证 PATH 上有 `olares-cli`。  
沙箱（`dsh-sandbox`）若默认限制网络/二进制，需在 Olares bundle 中为 CLI 相关调用配置策略或工作区信任，否则 skills「教了但跑不了」。

---



## 7. UI 策略：一比一复刻 WorkBuddy

### 7.1 参考对象

| 项 | 值 |
|---|---|
| 产品 | WorkBuddy Desktop |
| 包名 | `@genie/workbuddy-desktop` |
| 安装版本 | `app.asar` 标 5.3.8；**实机运行 v5.3.12**（以实机为准） |
| 技术 | Electron 37 + React SPA（Vite 打包）；主题语义贴近 VS Code CSS 变量 |
| 分析材料 | `app.asar` 文案与 chunk 名（**不入库**）+ **实机截图**（`_参考/workbuddy-ui/01-main.png`，已确认屏幕录制权限可用） |
| 截图限制 | 翻页需「辅助功能」权限（当前仅授权屏幕录制）；其余页面待补 |

### 7.2 壳层信息架构（第一期必须对齐）

> 以下为 **实机 v5.3.12 首页截图**（`_参考/workbuddy-ui/01-main.png`）核对结果，取代早前 5.3.8 文案包推断。实机把「专家/技能/连接器」合并为一项，无独立 Claw/插件顶级项。

主壳左栏 + 中央首页（首屏无右侧详情栏，进入任务后才出现）：

```text
┌──────── leftSidebar ─────────┬──────────────── 中央首页 / 对话区 ────────────────┐
│ [折叠] [搜索] [筛选]          │                              做任务赢积分好礼 ›   │
│ WorkBuddy v5.3.12            │            WorkBuddy, 我帮你                       │
│ ● 新建任务 (active)          │      [日常办公] [代码开发] [设计创意]              │
│   助理                       │   [文档处理][金融服务][数据分析及可视化]           │
│   项目                       │   [个人工作台][幻灯片][ › ]              (吉祥物)  │
│   专家·技能·连接器           │  ┌──────────────────────────────────────────┐   │
│   自动化                     │  │ 今天帮你做些什么？ @引用对话文件,/调用技能  │   │
│   资料库                     │  │                                            │   │
│   更多            应用·灵犀   │  │ +                     Auto ▾   🎤   ⬆(发送) │   │
│ ── 任务 (1) ▾                │  └──────────────────────────────────────────┘   │
│ ── 空间 (1) ▾                │    选择工作空间 ▾    默认权限 ▾                    │
│   项目新手指引 ▾             │                                                   │
│     生成项目功能介绍  8天前   │                                                   │
│ ┌────────────────────────┐  │                                                   │
│ │ Buddy加油站·7期  立即领取│  │                                                   │
│ └────────────────────────┘  │                                                   │
│ 🟢 罗龙            🔔  ⋯     │                                                   │
└──────────────────────────────┴───────────────────────────────────────────────────┘
```

**leftSidebar 顶级导航（权威，实机）：** 新建任务 / 助理 / 项目 / 专家·技能·连接器 / 自动化 / 资料库 / 更多（右侧副标「应用·灵犀」）。

**leftSidebar 下部：** 「任务(N)」「空间(N)」可折叠分组；项目/新手指引分组含条目（带相对时间「8天前」）；底部积分运营卡片 + 用户头像名 + 通知/更多图标。

**顶栏（左栏内）：** 侧栏折叠、搜索、筛选三枚图标；产品名 + 版本号。

**中央首页空态：** 主标题「WorkBuddy, 我帮你」；场景药丸切换（日常办公 / 代码开发 / 设计创意）；场景下快捷 chips（文档处理 / 金融服务 / 数据分析及可视化 / 个人工作台 / 幻灯片 / 更多 ›）；右侧吉祥物；输入框 placeholder「今天帮你做些什么？ @引用对话文件, / 调用技能与指令」；输入框工具条（+ / Auto▾ 模型 / 麦克风 / 发送）；输入框下方「选择工作空间▾」「默认权限▾」；右上「做任务赢积分好礼」。

**detailPanel（进入任务后，待补截图核对）：** 早前文案包为 任务 / 产物 / 全部文件 / 变更 / 预览 + 空态；需在任务态实机截图后定稿。

**设置 / 其它页（待截图）：** 助理、项目、专家·技能·连接器、自动化、资料库、更多、设置模态——当前因缺辅助功能权限无法自动翻页，需补截图。

> **品牌：** 复刻时结构不变，「WorkBuddy」文案位可改为 Dina 用词（用词表待确认）。

### 7.3 视觉与交互约束（1:1）

- **布局比例 / 折叠：** 左栏可 `sidebar-collapsed`；窄屏有 `isNarrowForSidebar` 行为；详情栏可 pin / expand / collapse。
- **主题：** 同时存在 `--wb-*` 与 `--cb-vscode-*` / VS Code 主题变量；默认浅色接近「IDE Light」。复刻时先建 **token 层**，再搭组件，禁止另起一套紫色/奶油风。
- **字体：** 系统 UI 字体 + 等宽编辑字体（与 WorkBuddy index 内联样式一致量级：13px UI / 14px editor）。
- **窗口：** 桌面版无边框 + `hiddenInset`；Olares Web 入口无系统 traffic lights，但**顶栏占位与内容起始线**应对齐，避免「矮一截」的假复刻。
- **交互：** 新建任务、切换任务、搜索过滤、打开设置、展开详情 Tab——第一期就要可点；未实现能力显示与 WorkBuddy 同构的空态，而不是删入口。

### 7.4 与 dsh 的装配方式（现行：路径 B）

| 层 | 选择 |
|---|---|
| Host | `dsh-base` + `dsh-web-app`（webserver / apiproxy / frontend-static）+ `@dina/bundle-web` overlay |
| Client | 默认 upstream `ui-*` roster；`@dina/client-dina` 等 inject；社区插件经 `dsh plugin add` |
| 静态资源 | `@deepseek-ai/dsh-web-frontend`（不自建平行 SPA dist） |
| WorkBuddy | 交互参考，非平行壳 |

历史「路径 A：独立 SPA」已废弃，见 §0。

### 7.5 第一期交付定义（UI Done）

在 Olares 入口打开后，**不看功能是否接通**，验收：

1. 左栏六项主导航 + 任务列表区 + 底栏用户/设置，视觉与 WorkBuddy 5.3.8 对齐；
2. 中间欢迎/空对话 + 底部输入区交互（发送键、Shift+Enter）一致；
3. 右侧详情五 Tab 可切换，空态文案结构一致；
4. 设置弹层能打开，分区入口齐全（内容可「即将推出」）；
5. Claw / 专家 / 技能 / 插件 / 自动化 均有入口页（可先静态）；
6. 品牌字符串可改为 Dina，但不得改变信息架构。

**像素对照：** 请为本机 Cursor/终端开启 macOS「屏幕录制」权限后补截图到 `_参考/workbuddy-ui/`，或直接导出若干窗口截图，作为验收基准。

### 7.6 法务与工程边界

- 不复制 WorkBuddy 商标图标、插画、专有 chunk 源码进 git；
- 允许：观摩布局、交互、文案结构、token 语义后**自研实现**；
- 第三方字体/图标用开源替代或自行绘制。

---

## 8. 推荐目标架构（Dina）

```text
┌──────────────────────── Olares Chart (dina) ────────────────────────┐
│  Entrance :8080 (authLevel: private)                                 │
│  Pod: dsh Host + WorkBuddy-shell dist                                │
│  Image: node22 + dsh + olares-cli + @dina bundles + shell assets     │
└─────────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┴────────────────────┐
         ▼                                         ▼
  dsh-base (+ Host 传输)                 @dina/workbuddy-shell (唯一 UI)
         │                                         │
         ├─ ctx.llm / shim / olares 路由            ├─ leftSidebar / chat / detail
         ├─ ctx.tools / bash + shellEnv             ├─ Settings / Claw / Skills…
         ├─ ctx.skills (olares SKILL.md)            └─ 经 RPC 调 Host（后接真能力）
         └─ @dina/bundle-olares
```

**仓库布局建议：**

```text
dina/
  packages/
    workbuddy-shell/          # UI 1:1（第一期主战场）
    olares-identity/
    olares-llm-shim/
    olares-skills/
    bundle-olares/            # Host + 关掉默认 dsh chat 花名册 + 挂我们的 dist
  _参考/
    deepseek-harness/         # 内核参考
    workbuddy-ui/             # 截图 / token 摘录（无专有源码）
  deploy/dina/
  docs/调研-….md
```

依赖获取：优先 npm/私有源上的 `@deepseek-ai/dsh*`；不整仓 fork。

---


## 9. 机器 1 部署要点

按现有约定（`dev-machines.mdc`）：


| 项    | 要求                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 热更新  | 机器 1 默认 `dev.hotReload=true`；`command` 含 `npm run dev` 或等价 dsh 开发启动；`HOT_RELOAD=true`；volume `app-data → /app`（`subPath: devsrc`）；initContainers `fix-dev-perms`、`seed-dev-src` |
| 包类型  | 覆盖部署默认装 **dev 包**；若临时装生产包，验证后装回                                                                                                                                                 |
| 绑定   | `webserver.host=0.0.0.0`，`port=8080`（对齐 Chart entrance）                                                                                                                         |
| 持久化  | `/data/dsh`（settings、sessions、credentials、profile）、`/data/workspace`、`/data/cli`                                                                                                |
| 依赖应用 | Manifest 继续声明 `router` + `olares>=1.12.7`                                                                                                                                       |
| 超时   | `options.apiTimeout: 0`（长 SSE）                                                                                                                                                  |
| 同步   | `scripts/dev-sync/sync.sh 1`；确认跑的是挂载代码而非镜像内死包                                                                                                                                   |


**与默认 dsh 前端差异：** 热更新对象主要是 `workbuddy-shell`；dsh Host 插件用 Cordis HMR。第一期可先生产构建验证壳，再打机器 1 热更新。

---

## 10. 分阶段执行建议



### Phase 0 — 决策闸门

- [x] 脱离 pi；内核 = dsh；UI = WorkBuddy 1:1
- [ ] 确认 dsh 依赖获取方式（npm / 私有源 / 子模块）
- [ ] 确认 Router 第一期 **Shim（方案 B）**
- [ ] 补齐 WorkBuddy 截图基准（屏幕录制权限）
- [x] 更新项目规则（见 `.cursor/rules/project.mdc`）



### Phase 1 — WorkBuddy 壳（可先不接通模型）

- [ ] `@dina/workbuddy-shell`：三栏壳 + 导航入口 + 空态 + 设置壳
- [ ] 本地 / 机器 1 入口能打开壳；视觉对照 5.3.8
- [ ] Host 最小挂载：静态 dist + 健康检查（可不聊）



### Phase 2 — 接通 dsh 对话最小集

- [ ] 任务列表 ↔ sessions；新建任务；流式消息
- [ ] `/llm/v1` shim + `olares` 路由；Desktop 内真实对话



### Phase 3 — olares-cli 冷路径

- [ ] 边缘身份 → CLI profile；`shellEnv`；挂载 olares-* skills



### Phase 4 — 按 WorkBuddy 入口填肉 + 硬化

- [ ] 技能 / 插件 / 自动化 / Claw / 专家 / 详情面板真实数据
- [ ] 热更新；沙箱与高危审批；评估去 shim
- [ ] 测试：适配器协议、shim 鉴权、身份隔离、skills 快照

---

## 11. 风险与开放问题

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| WorkBuddy 1:1 成本高 | 壳复杂、主题变量多 | Phase 1 只锁 IA + 主壳；截图基准驱动验收 |
| 无屏幕录制权限 | 当前环境无法截 WorkBuddy 窗 | 用户授权或手动导出 `_参考/workbuddy-ui/` |
| dsh developer preview | 破坏性变更 | 锁定版本；少 fork |
| 默认 dsh UI 干扰 | 与 WorkBuddy 壳冲突 | bundle 替换 dist，不挂默认 chat 花名册 |
| 无内建 HTTP 鉴权 | 误绑 `0.0.0.0` 即裸奔 | 依赖 Olares entrance auth |
| CLI 无 refresh token | cookie 过期后失败 | 与 Jarvis 相同限制；可诊断 |
| 专有资产误入库 | asar 源码/商标 | 规则禁止；只自研复刻 |

**开放问题：**

1. 第一期壳用独立 SPA（推荐）还是拆成多个 dsh `ui-*` 插件？
2. 品牌文案：结构对齐 WorkBuddy，中文用词是否全部换成 Dina？
3. olares-cli 长期：skills+bash，还是 `ctx.olaresCli` seam？
4. 工作区默认路径？

---

## 12. 关键参考索引

**dsh：** `_参考/deepseek-harness` 内 architecture / cordis-primer / capability-seams / LLM·tool·skill cookbook / `llm-pi-ai` / bundle patch。

**Olares 接入语义（非 UI）：** `test_lares` 的 `lib/olares`、skills、Dockerfile、chart。

**WorkBuddy UI：** 本机 App 5.3.8；结论见 §7（勿提交 asar 源码）。

---

## 13. 一句话决策记录

> **Dina = DeepSeek Harness 内核 + 自研 WorkBuddy 1:1 壳 + Olares 插件（Router shim / 身份 / skills / olares-cli）。彻底不使用 pi。UI 先对齐 WorkBuddy 5.3.8 的入口与交互，功能后补；机器 1 走现有 chart/dev-sync。**

下一步：补截图基准 → 开工 Phase 1 壳。
