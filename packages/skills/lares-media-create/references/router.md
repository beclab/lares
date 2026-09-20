# Router: call contract

Load this only when the front-door call line cannot run (missing verb, no `--out`, or you need the image data-plane). Produce already listed the family — do not list again, and do not run `--help`.

Never curl FlowStudio (`flowstudio-svc`, `/v1/images/generations`, `/api/v1/generations`, `/api/projects`), ComfyUI, or `router local` just to generate or to resolve a scene name. Router's list row is the scene.

## Pick

`--model` is `<provider>/<model>` as `router list` printed it. Omit it only when `olares-cli router default show` already names **this** mode. FlowStudio's `<model>` is usually the project UUID; `name` / `title` on that same row is the label — do not GET FlowStudio to map them.

Skip disabled rows. Skip a row whose title is another family. A FlowStudio video / 3D / `output=audio` scene may appear under the FlowStudio `image_generation` provider — that is a second place to look **after** the family's own mode is empty, never instead of `video_generation` / `music_generation`.

`speak` is TTS only — never use it for music.

## Call

Prefer `$LARES_LLM_BASE_URL` (the in-process shim). It stamps the logged-in user. Do not `olares-cli router call` to generate: in-cluster that presents as the Lares app, and FlowStudio would own the job as the shared chart owner.

POST the path that matches the **picked row's mode**, with `Prefer: respond-async`. Poll `GET $LARES_LLM_BASE_URL/generations/<id>` until completed. The shim fills `files_path` from FlowStudio's Files pointer — that is the artifact. Router's own GET does not carry it.

| Row mode | Shim path |
|---|---|
| `image_generation` (cloud image **and** a FlowStudio scene parked here, including video / 3D parked on this mode) | `/images/generations` |
| `video_generation` | `/videos` |
| `music_generation` | `/music/generations` |
| `model3d_generation` | `/generations` |

If the shim is down, POST the same suffix on **Router's** data plane (`LLM_GATEWAY_URL`, already `/v1/…`) and still send `x-bfl-user` / `remote-user` as the logged-in username. Pass `model` as `router list` printed it. When the poll JSON has no `files_path`, `olares-cli files cat drive/Data/flowstudio/userData/<username>/comfyui/outputs/.by-id/<output id>` — one line, the files address — then `workspace_publish` it. The sync form of `/images/generations` returns `b64_json` — including for a FlowStudio video parked on `image_generation`. Do not POST `/images/generations` for a real `video_generation` / `music_generation` catalog row.

- Never `olares-cli router call … --id`.

Then land with [deliver.md](deliver.md). A Router JSON body or `--out` path is not preview.

## Failures

- One row 404 / unpublished / wrong mode → next same-family row. Stay on produce.
- Auth, quota, “application not answering” → Router diagnosis (`router usage list`, `router provider get`). Still do not curl FlowStudio.
- **Do not** `provider sync-models`, `model add`, `model delete`, or `model update` to “fix” a generate request. Catalog repair is [flowstudio.md](flowstudio.md), and only when the family list is empty.
