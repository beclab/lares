# Deployment

Chart 只含部署结构与热更新机制；应用代码在镜像 / `devsrc` 里。入口为 **dsh web**（`npm run start` / `start:watch`）。

- 正式包：`scripts/package-chart.sh`
- 开发包：`scripts/package-chart.sh --dev`
- 源码同步：`scripts/dev-sync/sync.sh <machine> [all|packages]`
- 社区右侧栏：`scripts/install-better-sidebar.sh`（在已有 `dina-web` profile 上）

开发安装必须具备这四项：

```text
command         includes npm run start:watch
HOT_RELOAD      true
volumeMounts    app-data → /app (subPath: devsrc)
initContainers  fix-dev-perms, seed-dev-src
```

额外验收（dsh UI）：

```text
GET /api/health     kernel=dsh-web
合成 profile        dina-web（dsh-base + dsh-web-app + @dina/bundle-web）
```
