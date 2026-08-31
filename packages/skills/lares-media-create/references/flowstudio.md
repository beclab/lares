# FlowStudio: install and workflows

Load this only after Router's catalog had **no** matching generation row. Finding a workflow here does **not** authorize calling FlowStudio HTTP — submit the job through Router so GPU scheduling stays in one place.

Lifecycle verbs: [`olares-market`](../../olares-market/SKILL.md). Provider register / sync: [`olares-router`](../../olares-router/SKILL.md).

## Is it installed?

```bash
olares-cli market status flowstudio -o json
```

- App id is `flowstudio`. `running` (and other produce-ready states from the market skill) counts as installed.
- Missing, uninstalled, or stopped → this step is not a hit. Return to the front door (offer install only in [fallback.md](fallback.md), do not treat `ffmpeg_encode` as generation).
- Installed but Router still has no `image_generation` rows for it: register and re-mirror, then call through Router:

```bash
olares-cli router provider register flowstudio
olares-cli router provider sync-models flowstudio
olares-cli router list --mode image_generation -o json
```

`provider register` is only for an application that is already installed and has no Router row. Do not install a second copy.

## Matching workflow?

FlowStudio is a channel of published scenes, not one model. Router lists those scenes after sync. Match **output family**, not title poetry:

| Need | Workflow `output` / kind |
|---|---|
| Image | `image` (`t2i`, `i2i`, …) |
| Video | `video` (`t2v`, `i2v`, …) |
| Generative audio | `audio` |
| 3D | `model3d` |

A workflow that `needs_reference` / `needs_mask` is still a hit when the user supplied the media; otherwise pick a prompt-only scene.

If a match exists → start the job with [router.md](router.md) **Call**. Do not `curl` `flowstudio-svc`.

If FlowStudio is running but has no published, produce-ready scene for this family → say so. Installing a recommended scene is an admin action inside FlowStudio; do not author a Comfy graph as the first move. Then [fallback.md](fallback.md).
