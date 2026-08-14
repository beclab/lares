# Dina

Olares Chat：**dsh web UI 主壳** + **Olares Router LLM shim**（WorkBuddy 仅作交互参考）。

```text
packages/           dsh web boot + @dina/bundle-web / client-dina
deploy/dina/        Olares chart（可选热更新）
scripts/            镜像、chart 打包、dev-sync、better-sidebar 安装
_参考/              deepseek-harness / WorkBuddy 截图
docs/               调研文档
```

## Local

```bash
cd packages
cp .env.example .env   # 可选
npm ci
npm run build
npm run start          # http://127.0.0.1:8080  （dsh web）
```

本地无 Router 时，把 `LLM_GATEWAY_URL` 指到任意 OpenAI 兼容 `/v1`，或设置 `DINA_ROUTER_API_KEY`。

社区右侧工作台：

```bash
scripts/install-better-sidebar.sh
```

## Cluster（机器 1）

```bash
scripts/build-image.sh
scripts/package-chart.sh --dev
scripts/dev-sync/sync.sh 1
```

机器 1 默认热更新：`start:watch`，`HOT_RELOAD=true`，挂载 `devsrc`。

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP（dsh webserver） |
| `HOSTNAME` | `0.0.0.0` | Bind |
| `DINA_DATA_DIR` | `/data/dina` | 数据 + `dsh-home` profile |
| `DINA_WORKSPACE` | `/data/workspace` | 工作区 |
| `LLM_GATEWAY_URL` | `http://router-svc.router-shared/v1` | Router |
| `OLARES_APP_ID` | `dina` | `x-caller-appid` |
| `DINA_ROUTER_API_KEY` | empty | 可选 sk- |
| `DINA_DEFAULT_MODEL` | empty | 默认模型 id |
| `DSH_HOME` | `$DINA_DATA_DIR/dsh-home` | dsh profiles |
