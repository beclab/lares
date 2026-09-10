# Deployment

Chart 只含部署结构与热更新机制；应用代码在镜像 / `devsrc` 里。入口为 **dsh web**（`npm run start` / `start:watch`）。

- 正式包：`scripts/package-chart.sh`
- 开发包：`scripts/package-chart.sh --dev`
- 源码同步：`scripts/dev-sync/sync.sh <machine> [all|packages]`
- 社区右侧栏：`scripts/install-better-sidebar.sh`（在已有 `lares-web` profile 上）
- 语音输入：自研 `@lares/composer-voice`（`packages/web/composer-voice`，随镜像内建），STT 走 Router `/audio/transcriptions`，与 Ashia 同路径

开发安装必须具备这四项：

```text
command         includes npm run start:watch
HOT_RELOAD      true
volumeMounts    app-data → /app (subPath: devsrc)
initContainers  fix-dev-perms, seed-dev-src
```

`seed-dev-src` 用 overlay 里的 `.lares-image-id` 判断是否换了镜像：文件缺失就整层重刷。这个文件只在镜像里，同步脚本的 `--delete` 会删掉它，于是下一次重启把刚同步的代码冲回镜像版本。`project.json` 的 `hot_reload.excludes` 因此必须保留 `.lares-image-id`（该列表是整体替换默认值，不是追加）。

额外验收（dsh UI）：

```text
GET /api/health     kernel=dsh-web
合成 profile        lares-web（dsh-base + dsh-web-app + @lares/dsh-overlay）
```
