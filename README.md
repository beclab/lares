# Lares

Olares Chat：**dsh web UI 主壳** + **Olares Router LLM shim**（WorkBuddy 仅作交互参考）。

```text
packages/
  service/          业务：dsh web boot / Olares 集成
  plugins/          自研 dsh 插件（bundle-web、client-lares、voice-input）
  skills/           bundled agent skills
tests/              单元测试（与源码分离）
deploy/lares/        Olares chart（可选热更新）
scripts/            镜像、chart 打包、dev-sync、better-sidebar、无头浏览器验证
_参考/              deepseek-harness / WorkBuddy 截图
```

## Local

```bash
cp .env.example .env   # 可选
npm ci
npm run build
npm run start          # http://127.0.0.1:8080  （dsh web）
```

本地无 Router 时，把 `LLM_GATEWAY_URL` 指到任意 OpenAI 兼容 `/v1`。

社区插件（装进运行中的 `lares-web` profile）：

```bash
scripts/install-better-sidebar.sh 1   # 右侧工作台
```

语音输入是自研插件 `@lares/voice-input`（随镜像内建，无需单独安装）：输入框旁的
麦克风录音，录完经 `/api/lares/voice/transcribe` 走 Router STT 回填文本；在
**设置 → 语音输入** 里选模型 / 语言。语音模型需在 Olares 模型控制台另行安装。

## Cluster（机器 1）

```bash
scripts/build-image.sh          # 只打应用层；首次或无底座时会先打 Dockerfile.base
# scripts/build-image.sh --base # OS / CLI / node_modules 变更时才重建底座
scripts/package-chart.sh --dev
scripts/dev-sync/sync.sh 1
```

机器 1 默认热更新：`start:watch`，`HOT_RELOAD=true`，挂载 `devsrc`。

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP（dsh webserver） |
| `HOSTNAME` | `0.0.0.0` | Bind |
| `LARES_DATA_DIR` | `/data/lares` | 数据 + `dsh-home` profile |
| `LARES_WORKSPACE` | `/data/workspace` | 工作区 |
| `LLM_GATEWAY_URL` | `http://router-svc.router-shared/v1` | Router（本地可改；集群安装使用 mesh-in allowlist 入口） |
| `OLARES_APP_ID` | `lares` | `x-caller-appid` |
| `LARES_ROUTER_API_KEY` | empty | 仅本地可选 sk-；集群走应用身份 |
| `DSH_HOME` | `$LARES_DATA_DIR/dsh-home` | dsh profiles |

语音输入的模型 / 语言 / 市场应用改在 **设置 → 语音输入** 面板配置，持久化到
`$DSH_HOME/voice-input/config.json`。
