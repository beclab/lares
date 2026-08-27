# `@olares/lares-mobile`

LarePass 只依赖这一个包。对话、Host、设置都在内部走 `@olares/lares-core`，宿主不要再 import 或 link core。

```vue
<template>
  <LaresApp :locale="locale" v-bind="ports" />
</template>
<script setup>
import { LaresApp, laresPortsFromAccount, findLaresEntrance } from "@olares/lares-mobile";
</script>
```

设置页同样只挂 `LaresAgentSettings`。

正式 App：把当前登录账号的 `myApps` 交给 `laresPortsFromAccount`（或自己调 `findLaresEntrance` 得到 `baseUrl`）。入口前缀是安装时随机的，不要拼 `lares.<用户>.olares.com`，也不要把 webpack `.env` 里的调试子域带进生产。

PC 预览：`IS_PC_TEST` 时走 `/laresHost` 代理，`laresPortsFromAccount` 会继续用 `PROTOCOL` / `LARES_SUB_DOMAIN` / `ACCOUNT_DOMAIN`。自定义鉴权请求再传 `request`。

切账号时更新 `baseUrl` / `env` 即可，客户端会丢掉上一台的 runtime 和设置缓存，改连新 Host。

本地联调（包未上 registry 时）：

```bash
# dina
npm link --workspace=@olares/lares-mobile

# TermiPass/packages/app
npm link @olares/lares-mobile
```
