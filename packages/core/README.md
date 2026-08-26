# @lares/core

Business rules live here once. `packages/web` and `packages/mobile` only render
and bind UI; they must not grow a second copy of catalog, path, media, or
identity policy.

Import surfaces (`@lares/core/<export>`):

- `tools/*`: HTTP helpers, JSON file IO, in-flight coalescing, insecure-origin `randomUUID` shim.
- `router/*`: Router transport contracts, catalog normalization, LLM shim, model / STT / search policy, catalog sync, session model switching, and search error codes.
- `workspace/*`: workspace boundaries, default seed, and dsh session-to-workspace resolution.
- `files/*`: intake, preview workspace, markdown rewrite, Host upload/preview HTTP.
- `drive/*`: path policy, tool execution, present cards, and agent tool definitions.
- `voice/*`, `search/*`: STT/search settings, Host payloads, and client API contracts.
- `olares/*`: Olares entrance identity, trusted-host loopback, and CLI session materialization.
- `larepass/host`: find the Lares entrance from LarePass `myApps`, PC-test proxy URLs, Host probe, and `hostConfigFromEnv`.
- `larepass/rpc`, `larepass/transcript`, `larepass/chat`, `larepass/mux`, `larepass/runtime`: dsh host-RPC envelope, session fold (text / reasoning / tools / produced files), browser mux as WebSocket (same frames as PC), and the LarePass chat runtime (UI only subscribes).
- `brand/identity`, `brand/manifest`: product identity and PWA manifest consumed by the Host and clients.
- `icons/*`: product mark SVG and public icon paths (no React).
- `i18n/*`: ZH/EN catalogs and `t` / `{name}` interpolation (no React, no dsh locale), including the LarePass mobile shell.

Core may depend on Node.js and backend libraries, but never on `packages/web`,
`packages/mobile`, React, or browser UI.
