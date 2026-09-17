# FlowStudio: empty catalog only

Load this only after produce listed the family and found **no usable row** (empty list, or every same-family row already failed). One stale 404 is not an empty catalog — go back and try the next row.

Finding a workflow here does **not** authorize calling FlowStudio HTTP. Submit through Router.

Lifecycle verbs: [`olares-market`](../../olares-market/SKILL.md). Provider register / sync: [`olares-router`](../../olares-router/SKILL.md).

## Is it installed?

```bash
olares-cli market status flowstudio -o json
```

- App id is `flowstudio`. `running` (and other produce-ready states from the market skill) counts as installed.
- Missing, uninstalled, or stopped → this step is not a hit. Return to the front door (offer install only in [fallback.md](fallback.md)).
- Installed **and** this family's Router list is empty: **ask the user** before register / sync. Sync replaces the provider catalog and can delete working rows. Do not guess the provider name as `flowstudio` when `router list` already showed `flowstudio-manual`.

```bash
olares-cli router provider register flowstudio
olares-cli router provider sync-models flowstudio
olares-cli router list --mode image_generation -o json
olares-cli router list --mode video_generation -o json
olares-cli router list --mode music_generation -o json
```

`provider register` is only for an application that is already installed and has no Router row. Do not install a second copy. After a sync the user approved, return to produce (list → pick → call). Do not keep repairing modes with `model add` / `model delete`.

## Matching workflow?

FlowStudio is a channel of published scenes. Match **output family**, not title poetry:

| Need | Workflow `output` / kind |
|---|---|
| Image | `image` (`t2i`, `i2i`, …) |
| Video | `video` (`t2v`, `i2v`, …) |
| Generative audio | `audio` |
| 3D | `model3d` |

A workflow that `needs_reference` / `needs_mask` is still a hit when the user supplied the media; otherwise pick a prompt-only scene.

If a match exists → start the job with the front-door **Call**. Do not `curl` `flowstudio-svc`.

If FlowStudio is running but has no published, produce-ready scene for this family → say so. Installing a recommended scene is an admin action inside FlowStudio; do not author a Comfy graph as the first move. Then [fallback.md](fallback.md).
