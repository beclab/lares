# Lares

[English](README.md) | [简体中文](README_CN.md)

A chat application for Olares: **Web shell** + **Olares Router** (with WorkBuddy used only as an interaction reference).

```text
packages/
  service/          Startup and Olares orchestration
  core/             `@olares/lares-core` shared business logic for desktop and mobile
  web/              Desktop web UI
  mobile/           Mobile UI
  skills/           lares-* agent skills (olares-* are exported at build time and are not committed; ha-* are downloaded from hass-cli in Settings)
tests/              Unit tests, kept separate from source code
deploy/lares/       Olares chart with optional hot reload
scripts/            Image and chart packaging, dev sync, better-sidebar, and headless browser verification
_参考/              Upstream UI and WorkBuddy screenshots
```

## Local development

```bash
cp .env.example .env   # Optional
npm ci
npm run build
npm run start          # http://127.0.0.1:8080 (dsh web)
```

If Router is unavailable locally, point `LLM_GATEWAY_URL` to any OpenAI-compatible `/v1` endpoint.

To install a community plugin into the running `lares-web` profile:

```bash
scripts/install-better-sidebar.sh 1   # Right-side workspace
```

Voice input is provided by the built-in `@lares/composer-voice` plugin and does not require a separate installation. Use the microphone next to the composer to record audio. After recording, Lares sends it to Router STT through `/api/lares/voice/transcribe` and inserts the transcription into the composer. Select the model and language under **Settings → Voice Input**. Voice models must be installed separately in Olares Model Console.

## Cluster (machine 1)

```bash
scripts/build-image.sh          # Build only the app layer; also builds Dockerfile.base if the base image is missing
# scripts/build-image.sh --base # Rebuild the base only after OS, CLI, or node_modules changes
scripts/package-chart.sh --dev
scripts/dev-sync/sync.sh 1
```

Hot reload is a runtime switch. The chart always mounts `devsrc` at `/devsrc`. At startup, the container entrypoint reads `devsrc/.hotreload` once to decide whether to use the image code or the overlay. Toggle it with `scripts/dev-sync/hot-reload.sh on|off <machine>` (which updates the marker and restarts the pod). `sync.sh` enables it automatically when needed, so repackaging or reinstalling is unnecessary. After syncing, `kill -HUP` triggers a hot reload; the container does not poll files.

## Release

`docker.io/beclab/lares` is a multi-architecture image for amd64 and arm64. [`.github/workflows/image.yml`](.github/workflows/image.yml) builds it on two native runners and combines the results into a manifest list. The workflow is triggered only by pushing a `v<Chart.yaml version>` tag or by manual dispatch. Local `scripts/build-image.sh` still builds a single architecture with `--load`; test distribution uses `scripts/deploy-image.sh`.

The authoritative version is `deploy/lares/Chart.yaml`. CI verifies that the image tag in `values.yaml` and the version in `OlaresManifest.yaml` match it. The base image (`beclab/lares-base`) is built only when the `image_base_tag` from `project.json` does not already exist in the registry. Remember to bump that tag after changing `Dockerfile.base`.

## Agent skills

`packages/skills/lares-*` contains skill source maintained in this repository and included in the image. `packages/skills/olares-*` is not committed. During the application image build, `olares-cli skills export packages/skills` exports those skills from the olares-cli binary in the base image. Skill commands must come from the same release as the binary; a manually copied snapshot cannot guarantee that.

`ha-*` is also not committed. In **Settings → Skills**, Lares installs `@olares/hass-cli`, then runs `hass-cli skill list` and `skill show` to export the skills embedded in the binary to `$LARES_DATA_DIR/skill-packs/ha`. The skills are copied into the runtime skills directory only after they are enabled.

To upgrade Olares skills, update the `@olares/cli` version in `Dockerfile.base`, then run `scripts/build-image.sh --base`. At startup, `seedOlaresSkills` copies both the source skills bundled in the image and the exported Olares skills into `$LARES_DATA_DIR/skills`, which dsh receives through `DSH_BUNDLED_SKILL_DIR`.

For local, non-container development, export Olares skills once yourself:

```bash
olares-cli skills export packages/skills
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port for the dsh webserver |
| `HOSTNAME` | `0.0.0.0` | Bind address |
| `LARES_DATA_DIR` | `/data/lares` | Data and `dsh-home` profile |
| `LARES_WORKSPACE` | `/data/workspace` | Workspace |
| `LLM_GATEWAY_URL` | `http://router-svc.router-shared/v1` | Router endpoint; configurable locally, while cluster installs use the mesh-in allowlist entrance |
| `OLARES_APP_ID` | `lares` | `x-caller-appid` |
| `LARES_ROUTER_API_KEY` | empty | Optional local `sk-` key; cluster installs use application identity |
| `LARES_FILES_BASE_URL` | cluster injected | Files user-entrance template; `{user}` is replaced for the current browser request |
| `DSH_HOME` | `$LARES_DATA_DIR/dsh-home` | dsh profiles |

Configure the voice input model, language, and Market application under **Settings → Voice Input**. Settings are persisted to `$DSH_HOME/voice-input/config.json`.
