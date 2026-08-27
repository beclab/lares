# `@lares/mobile`

LarePass 只依赖这一个包。对话、Host、设置都在内部走 `@lares/core`，宿主不要再 import 或 link core。

```vue
<template>
  <LaresApp :locale="locale" :env="env" />
</template>
<script setup>
import { LaresApp } from "@lares/mobile";
</script>
```

设置页同样只挂 `LaresAgentSettings`。

`env` 由宿主注入（`PROTOCOL` / `LARES_SUB_DOMAIN` / `ACCOUNT_DOMAIN` / `IS_PC_TEST`）。PC 预览走 `/laresHost` 代理时设 `IS_PC_TEST`。需要自定义鉴权请求时再传 `request`。

本地联调（包未上 registry 时）：

```bash
# dina
npm link --workspace=@lares/mobile

# TermiPass/packages/app
npm link @lares/mobile
```
