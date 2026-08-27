# Lares

Olares 上的聊天应用：**Web 主壳** + **Olares Router**（WorkBuddy 仅作交互参考）。

```text
packages/
  service/          启动与 Olares 编排
  core/             `@olares/lares-core` 业务逻辑子包（PC / 移动端共用）
  web/              PC 端 UI
  mobile/           移动端 UI
  skills/           ha-* agent skills（olares-* 由构建期导出，不入仓）
tests/              单元测试（与源码分离）
deploy/lares/        Olares chart（可选热更新）
scripts/            镜像、chart 打包、dev-sync、better-sidebar、无头浏览器验证
_参考/              上游 UI / WorkBuddy 截图
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

语音输入是自研插件 `@lares/composer-voice`（随镜像内建，无需单独安装）：输入框旁的
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

## Release

`docker.io/beclab/lares` 是多架构镜像（amd64 + arm64），由
[`.github/workflows/image.yml`](.github/workflows/image.yml) 在双原生 runner 上构建后合成
manifest list。触发只有推 `v<Chart.yaml 版本>` 标签或手动 dispatch 两种；本地
`scripts/build-image.sh` 仍然只打单架构、只 `--load`，测试分发走
`scripts/deploy-image.sh`。

版本的权威是 `deploy/lares/Chart.yaml`，CI 会断言 `values.yaml` 的镜像 tag 与
`OlaresManifest.yaml` 的 version 跟它一致。底座（`beclab/lares-base`）只在
`project.json` 的 `image_base_tag` 在 registry 里还不存在时才构建——改了
`Dockerfile.base` 记得抬那个 tag。

## Agent skills

`packages/skills/ha-*` 是本仓源码；`packages/skills/olares-*` 不入仓，由应用镜像
构建时 `olares-cli skills export packages/skills` 从底座里的 olares-cli 导出——技能
描述的动词必须与手上那个二进制同一个 release，手抄的快照做不到这件事。

升级 olares 技能 = 改 `Dockerfile.base` 里 `@olares/cli` 的版本，再
`scripts/build-image.sh --base`。启动时 `seedOlaresSkills` 把两类技能一起复制到
`$LARES_DATA_DIR/skills`，经 `DSH_BUNDLED_SKILL_DIR` 交给 dsh。

本地跑（非容器）需要这些技能时，自己执行一次
`olares-cli skills export packages/skills`。

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
