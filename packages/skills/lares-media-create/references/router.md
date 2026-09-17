# Router: call contract

Load this only when the front-door call line cannot run (missing verb, no `--out`, or you need the image data-plane). Produce already listed the family — do not list again, and do not run `--help`.

Never curl FlowStudio (`flowstudio-svc`, `/v1/images/generations`, `/api/v1/generations`), ComfyUI, or `router local` just to generate.

## Pick

`--model` is `<provider>/<model>` as `router list` printed it. Omit it only when `olares-cli router default show` already names **this** mode.

Skip disabled rows. Skip a row whose title is another family. A FlowStudio video / 3D / `output=audio` scene may appear under the FlowStudio `image_generation` provider — that is a second place to look **after** the family's own mode is empty, never instead of `video_generation` / `music_generation`.

`speak` is TTS only — never use it for music.

## Call

Prefer the front-door `router call` line with `--out`. A missing CLI verb is not a missing catalog row: if there is no music verb, `music_generation` is still a hit — use Router's data plane for that mode (gateway from `olares-cli router status`, or in-cluster `LLM_GATEWAY_URL`).

For `image_generation` rows (cloud image models **and** FlowStudio workflows registered on Router):

- Prefer `router call image … --out` (`.webp` for images; `.mp4` / `.glb` when the row is a parked FlowStudio video / 3D scene).
- If that verb cannot write a file, POST to **Router's** data plane `/v1/images/generations` (the gateway `olares-cli router status` reports, or `LLM_GATEWAY_URL`). Pass `model` as `router list` printed it. That endpoint returns `b64_json` — including for a FlowStudio video parked on this mode. Do not POST it for a real `video_generation` / `music_generation` catalog row.
- Never `router call … --id`.

Then land with [deliver.md](deliver.md). A Router JSON body or `--out` path is not preview.

## Failures

- One row 404 / unpublished / wrong mode → next same-family row. Stay on produce.
- Auth, quota, “application not answering” → Router diagnosis (`router usage list`, `router provider get`). Still do not curl FlowStudio.
- **Do not** `provider sync-models`, `model add`, `model delete`, or `model update` to “fix” a generate request. Catalog repair is [flowstudio.md](flowstudio.md), and only when the family list is empty.
