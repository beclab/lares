# @lares/core

Business rules live here once. `packages/web` and `packages/mobile` only render
and bind UI; they must not grow a second copy of catalog, path, media, or
identity policy.

Import surfaces (`@lares/core/<export>`):

- `tools/*`: HTTP helpers, JSON file IO, in-flight coalescing, insecure-origin `randomUUID` shim.
- `router/*`: Router transport contracts, catalog normalization, LLM shim, model / STT / search policy, and catalog sync.
- `workspace/*`: workspace boundaries, default seed, and dsh session-to-workspace resolution.
- `files/*`: intake, preview workspace, markdown rewrite, Host upload/preview HTTP.
- `drive/*`: path policy, tool execution, and present cards.
- `voice/*`, `search/*`: STT/search settings, Host payloads, and client API contracts.
- `olares/*`: Olares entrance identity, trusted-host loopback, and CLI session materialization.
- `brand/identity`: product identity consumed by the Host and clients.
- `icons/*`: product mark SVG and public icon paths (no React).

Core may depend on Node.js and backend libraries, but never on `packages/web`,
`packages/mobile`, React, or browser UI.
