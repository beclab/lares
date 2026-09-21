# Deployment

Chart 只含部署结构；应用代码在镜像 / `devsrc` 里。镜像入口固定为 `node dist/service/launch.js`，它在运行期决定跑哪一份。

- 正式包：`scripts/package-chart.sh`
- 开发包：`scripts/package-chart.sh --dev`（与正式包唯一差别是版本号）
- 热更新开关：`scripts/dev-sync/hot-reload.sh on|off|status <machine>`
- 源码同步：`scripts/dev-sync/sync.sh <machine> [all|packages]`（未开热更新时自动开）
- 社区右侧栏：`scripts/install-better-sidebar.sh`（在已有 `lares-web` profile 上）
- 语音输入：自研 `@lares/composer-voice`（`packages/web/composer-voice`，随镜像内建），STT 走 Router `/audio/transcriptions`，与 Ashia 同路径

热更新不是安装期选项：`dev.hotReload` 这种 value 一旦写进首装就只能卸载重装才能改（app-service 的 upgrade 沿用首装 values）。所以两种模式的渲染结果完全一致：

```text
command         无（镜像 CMD: node dist/service/launch.js）
volumeMounts    app-data → /devsrc (subPath: devsrc)
env             LARES_DEV_OVERLAY=/devsrc
initContainers  fix-data-perms（顺带建好 devsrc 并 chown 1000）
```

`launch.js` 启动时读一次 `/devsrc/.hotreload`：不在就 in-process 起镜像里的 `index.js`；在就比较镜像的 `.lares-image-id` 与 overlay 的 `.lares-seeded-image-id`（不一致则清空 overlay 重新 `cp -a /app/.`，复制全部成功后才写完成标记），再以 `/devsrc` 为 cwd 拉起子进程。

两种「重来」都是主动触发，容器里没有任何轮询：

```text
换模式    改 .hotreload → hot-reload.sh 重启 pod（启动时才读这个标记）
热重载    sync.sh rsync 落地后 kubectl exec kill -HUP 1 → supervisor 重起服务
```

SIGHUP 必须直达 supervisor，所以 `Dockerfile` 把 CMD 覆盖成 `node dist/service/launch.js`（`npm run start` 不转发这个信号），tini 作为 pid 1 转发给它。

播种发生在应用容器里（不是 initContainer：切换只重启容器，initContainer 不会重跑），所以主容器配了 `startupProbe`，首次播种 `node_modules` 期间不会被 liveness 打死。

同步脚本的 `--delete` 如果删掉 `.lares-seeded-image-id`，下一次重启会把刚同步的代码冲回镜像版本；删掉 `.hotreload` 则会切回正式模式。`project.json` 的 `hot_reload.excludes` 因此必须保留这两项（该列表是整体替换默认值，不是追加）。

额外验收（dsh UI）：

```text
GET /api/health     kernel=dsh-web
合成 profile        lares-web（dsh-base + dsh-web-app + @lares/dsh-overlay）
```
