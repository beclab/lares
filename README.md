# Lares

The [pi coding agent](https://github.com/badlogic/pi-mono) packaged as an Olares app: one container with a Node backend that embeds the pi SDK and a Quasar web UI, wired to Olares' built-in LLM gateway so there is nothing to configure after install.

## Layout

```
packages/shared   types shared by the backend and the UI
packages/server   Hono backend: pi sessions, REST + SSE, gateway shim, static hosting
packages/web      Quasar SPA
docker            Dockerfile, entrypoint, reference compose file
chart/lares       Olares chart
scripts           mock gateway for local development
docs              design specs
```

## What it does

- **Chat** with streaming output, rendered tool calls, Markdown with Mermaid and KaTeX, image attachments, steering and follow-up queues, abort, and manual or automatic compaction.
- **Sessions** grouped by working directory, with a branch tree you can rewind into, forking either at or just before a message, renaming, deletion, and HTML or JSONL export.
- **Files** as a lazy tree with git status, previews for source, Markdown, images, audio, video, PDF and DOCX, unified diffs, and `@`-mention autocomplete backed by a git-aware index.
- **Configuration** for models, provider API keys and OAuth logins, thinking level, skills, plugins, and per-session tool toggles.
- **Worktrees**: create a checkout per branch, switch the file tree and new sessions onto it, and remove it when the work lands.

## How it fits together

The backend does four things in one process: it hosts the SPA, serves the REST and SSE API, holds the live pi sessions, and proxies pi's LLM traffic to the gateway.

That last part exists because of a hard conflict. pi talks to OpenAI-compatible endpoints through the official OpenAI SDK, which requires a non-empty API key and always sends an `Authorization` header. The Olares LLM gateway's zero-config path is the opposite: no `Authorization` at all, just `X-Olares-App-ID`. So pi points at a loopback route inside the container, and the shim swaps the credentials before forwarding. The design spec has the full reasoning: [docs/superpowers/specs/2026-07-26-lares-olares-pi-agent-design.md](docs/superpowers/specs/2026-07-26-lares-olares-pi-agent-design.md).

## Development

Requires Node 22.19 or newer.

```bash
npm install
npm run build -w @lares/shared     # the other packages import its built types

# terminal 1: a fake gateway so you do not burn real tokens
node scripts/mock-gateway.mjs

# terminal 2: the backend
PI_CODING_AGENT_DIR=/tmp/lares/agent \
LARES_WORKSPACE=/tmp/lares/workspace \
LLM_GATEWAY_URL=http://127.0.0.1:8099/v1 \
OLARES_APP_ID=lares \
npm run dev:server

# terminal 3: the UI, proxying /api to the backend
npm run dev:web
```

Checks:

```bash
npm run check   # biome + typecheck across all packages
npm test        # server unit and end-to-end tests
```

The end-to-end test boots the real server against a fake gateway and drives a full prompt through pi, so it catches shim and session-wiring regressions without needing a cluster.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `30141` | HTTP port. Also baked into the shim URL in `models.json`. |
| `HOST` | `0.0.0.0` | Listen address. |
| `PI_CODING_AGENT_DIR` | `/data/pi/agent` in the image | pi's config and session root. |
| `LARES_WORKSPACE` | `/data/workspace` in the image | Default working directory for new sessions. |
| `LLM_GATEWAY_URL` | `http://llm-gateway-backend.os-framework:8080/v1` | Upstream OpenAI-compatible endpoint. |
| `OLARES_APP_ID` | unset | Sent as `X-Olares-App-ID`. The gateway registers the name on first contact. |
| `LARES_GATEWAY_API_KEY` | unset | When set, the shim authenticates as a user with this bearer token instead. |
| `PI_DEFAULT_MODEL` | unset | `provider/id` seeded into `settings.json` on first boot. |
| `LARES_WEB_ROOT` | `/app/web` in the image | Directory holding the built SPA. |

Config is seeded, not enforced: the first boot writes the gateway provider into `models.json` and a default model into `settings.json`, then leaves your later edits alone.

## The workspace

Everything the app can read or write lives under `LARES_WORKSPACE`. Paths are resolved through `realpath` and checked against that root, so a symlink pointing outside is refused rather than followed, and a session cannot be started outside it either.

Worktrees are created inside the workspace at `.worktrees/<repo>/<branch>` rather than beside the repository, which is where git would normally put them, because the file routes only serve the workspace. When the repository *is* the workspace root, `.worktrees/` is added to `.git/info/exclude` so the checkouts do not show up as untracked.

## Container

```bash
docker build -f docker/Dockerfile -t lares:0.1.0 .
docker run --rm -p 30141:30141 \
  -e LLM_GATEWAY_URL=http://host.docker.internal:8099/v1 \
  -e OLARES_APP_ID=lares \
  -v lares-data:/data \
  lares:0.1.0
```

The image runs as uid 1000 to match how Olares mounts app storage.

## Olares

```bash
olares-cli chart lint ./chart/lares
olares-cli chart package ./chart/lares
```

Two chart details are load-bearing. `options.apiTimeout: 0` disables the entrance proxy's 15 second request cap, which would otherwise sever the SSE event stream mid-answer. `permission.appData: true` plus the `hostPath` mount on `.Values.userspace.appData` is what gives sessions somewhere durable to live.
