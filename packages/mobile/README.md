# `@olares/lares-mobile`

LarePass 只依赖这一个包。对话、Host、设置都在内部走 `@olares/lares-core`，宿主不要再 import 或 link core。

```vue
<template>
  <LaresApp :locale="locale" :device="device" v-bind="ports" />
</template>
<script setup>
import { LaresApp, laresPortsFromAccount, findLaresEntrance } from "@olares/lares-mobile";
</script>
```

`device` 为 `desktop` 时对话列居中、宽 748px；`mobile`（默认）保持全宽。

设置页同样只挂 `LaresAgentSettings`。

正式 App：把当前登录账号的 `myApps` 交给 `laresPortsFromAccount`（或自己调 `findLaresEntrance` 得到 `baseUrl`）。入口前缀是安装时随机的，不要拼 `lares.<用户>.olares.com`，也不要把 webpack `.env` 里的调试子域带进生产。

PC 预览：`IS_PC_TEST` 时走 `/laresHost` 代理，`laresPortsFromAccount` 会继续用 `PROTOCOL` / `LARES_SUB_DOMAIN` / `ACCOUNT_DOMAIN`。自定义鉴权请求再传 `request`。

宿主页面与 Host 跨源时（打包桌面端是 `file://`）必须传 `request`，浏览器不会带上 Olares cookie，靠 cookie 的默认实现一律 401。`request` 会用在所有调用上，包括聊天附件上传和语音转写这两个二进制请求——它们的 `body` 是 `File` / `Blob`，`headers` 里自带 `content-type`，实现里不要再当成 JSON 序列化。

```js
async function request(url, { method = "GET", body, headers, signal } = {}) {
  // body 可能是 File / Blob，原样发出去
  const res = await send(url, { method, body, headers, signal, token });
  return { ok: res.ok, status: res.status, body: res.json }; // 4xx 也要返回，不要 throw
}
```

事件流 `/api/events.mux` 是唯一带不了 header 的调用——浏览器 `WebSocket` 构造器不收 header。Olares 会从 `Sec-WebSocket-Protocol` 取 token 提升成 `X-Authorization` 再走入口鉴权，所以另外传 `socketProtocol`：

```js
ports.socketProtocol = () => currentUser.access_token; // 传函数则每次连接现取，换 token 无需重建 runtime
```

也接受直接给字符串或数组。**不传就不传**，不要传空串——服务端不回应的子协议会让握手直接失败，同源的 PC 端保持裸构造。

切账号时更新 `baseUrl` / `env` 即可，客户端会丢掉上一台的 runtime 和设置缓存，改连新 Host。

本地联调（包未上 registry 时）：

```bash
# dina
npm link --workspace=@olares/lares-mobile

# TermiPass/packages/app
npm link @olares/lares-mobile
```
