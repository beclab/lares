# `@lares/mobile`

LarePass 只提供入口（底栏、路由、顶栏），然后挂载这个组件。对话、Host RPC、滚动都在包内。

```vue
<template>
  <LaresApp :locale="locale" :env="env" />
</template>
<script setup>
import { LaresApp } from "@lares/mobile";
</script>
```

`env` 由宿主注入（`PROTOCOL` / `LARES_SUB_DOMAIN` / `ACCOUNT_DOMAIN` / `IS_PC_TEST`）。PC 预览走 `/laresHost` 代理时设 `IS_PC_TEST`。需要自定义鉴权请求时再传 `request`。

更新：在 LarePass 里升 `@lares/mobile` 版本即可。
