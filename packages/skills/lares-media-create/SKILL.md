---
name: lares-media-create
version: 0.4.0
description: "Produce image, video, audio, or 3D through Router: list that family, POST the matching shim route, land the file. Use for 生成图片, 生成视频, text-to-image, FlowStudio generate, FlowStudio 场景/工作流, T2V, I2V, R2V, 文生视频, 图生视频. Not for Router install, catalog sync, GPU diagnosis, or curling FlowStudio."
metadata:
  requires:
    bins: ["curl"]
---

# lares-media-create

A generate / create request is **produce**, not platform diagnosis. A FlowStudio scene or workflow is this skill.

Do not load other skills (including olares-router). Do not curl FlowStudio or ComfyUI — not to generate, not to list scenes, not to map a UUID to a title. Do not run `--help`. Do not `provider sync-models`, `model add`, `model delete`, or `market status` unless the family list is **empty**. Do not narrate this protocol.

## Produce

1. Map the ask to **one** family (table below).
2. List that family only through the in-process shim. This catalog route uses
   the same Router identity as generation and does not need `olares-cli`'s
   profile lock outside the workspace sandbox:

```bash
curl -sS "$LARES_LLM_BASE_URL/models"
```

   Keep only rows whose `mode` is the matching family. For video, if that list is empty, also inspect `image_generation` (FlowStudio sometimes parks video scenes there). Never probe `audio` for a song. Do not use `olares-cli router list` here: workspace-write cannot create its refresh lock under `/data/home`.

3. Pick one **enabled** row of this family. Prefer a prompt-only scene. Skip a row whose title is clearly another family (a T2V scene is not an image). `--model` is `<provider>/<model>` as listed — FlowStudio's model half is often a UUID; that **is** the id, and `name` on the **same JSON row** is the label to say it by. Never GET FlowStudio to map a UUID to a title. `flowstudio.parameters`, when present, lists that scene's exposed controls. Each entry carries the exact `key` to submit plus its human `label`, type, default, bounds, and options. Match the user's words to `label`; send the chosen values under `flowstudio.params` using `key`. For a select, send the option's `value`, not its display label. Do not invent a key absent from `flowstudio.parameters`. This provider-specific object is only for a row that actually has `flowstudio.parameters`.

   When the user named a scene, that row **is** the pick — match their words against `name` on the listed rows and run that one. A detail absent from both `flowstudio.parameters` and `canonical_fields` is dropped from the body and said in the reply; it is never a reason to run a scene the user did not ask for. Do not switch to a row that "fits better".
4. Call **once** with the user's prompt unchanged, through `$LARES_LLM_BASE_URL` (in-process Router shim; default `http://127.0.0.1:$PORT/llm/v1`). That stamps the logged-in Olares user, so FlowStudio owns the job as this person — never as the shared chart owner. Do not `olares-cli router call` to generate (in-cluster it presents as the Lares app). Route follows the **picked row's mode**:

| Row mode | POST `$LARES_LLM_BASE_URL/…` |
|---|---|
| `image_generation` | `/images/generations` |
| `video_generation` | `/videos` |
| `music_generation` | `/music/generations` |
| `model3d_generation` | `/generations` |

   A video scene parked under `image_generation` still uses the **image** route. A `video_generation` row uses `/videos`. Set a long bash timeout; poll `GET $LARES_LLM_BASE_URL/generations/<id>` until completed. Each output carries `files_path` — the Olares files address of the **same** bytes already stored, the original rather than a copy. `workspace_publish` it. Do not GET `/content`, do not write `outputs/`, and do not copy the file into Home or anywhere else just to preview. Do not `router call … --id`.

   Omitting `seed` gives the run a fresh one, so "再来一张" is this same call again and returns a different result. Send a seed only to reproduce a specific earlier result, and only if the row's `canonical_fields` names it.

```bash
curl -sS -X POST "$LARES_LLM_BASE_URL/videos" \
  -H 'content-type: application/json' -H 'prefer: respond-async' \
  -d '{"model":"<provider>/<model>","prompt":"<prompt>","flowstudio":{"params":{"<parameter key>":"<value>"}}}'
```

   Swap the path from the table.

   **I2V / R2V / image edit** — the reference goes on that same POST as `reference_images`, an array of `data:image/<type>;base64,…` URLs (the row's `canonical_fields` spells this `inputs.images`; on these routes the body key is `reference_images`). Never `image`, `images`, `input_image`, a bare path, or an `https://` link. Do not send `operation`. Example: [router.md](references/router.md#image-to-video).

   The user asked for I2V (or named an I2V scene) but gave no image → ask for one, or say you will first generate a reference image with an `image_generation` row and then animate it. Never switch to a T2V row on your own.

   `media_input_required` / `media_input_unsupported` / `media_field_unknown`: the error names the key the route wants — fix the body **once** to that spelling and retry. A second refusal ends the attempt: report the error text to the user. Do not try other spellings, do not grep `/app` or the Router source, do not curl Router's data plane to bypass the shim.

5. Land the file ([deliver.md](references/deliver.md)). **Images / video / audio / 3D:** `workspace_publish` the `files_path`; do not `read_image` by first copying the file, and do not close the reply with that path as a link. Do not claim success from the filename or the prompt.

A **single-row** failure (404 unpublished, wrong mode) is still this step: try the **next same-family row**. It is not “Router cannot generate”. Do not sync or rewrite the catalog. Never `--id` refetch. A named row only moves after its own call failed, and then the reply says which row ran instead.

Call details and data-plane fallback: [router.md](references/router.md) — only if the shim POST above cannot run.

Empty list, or every same-family row failed: [flowstudio.md](references/flowstudio.md). If that cannot help: [fallback.md](references/fallback.md).

## Families

Router **mode** is the catalog key. User words like “音频 / 声音” are not that key.

| User wants | Router mode | Also a hit |
|---|---|---|
| Image generate or edit | `image_generation` | FlowStudio `output=image` |
| Video | `video_generation` | FlowStudio `output=video` (may also appear under the FlowStudio `image_generation` provider) |
| Speech / TTS | `audio` with TTS flags | shim `/audio/speech` |
| Music / song / generative audio | `music_generation` | FlowStudio `output=audio` |
| 3D / mesh / glb | `model3d_generation` | FlowStudio `output=model3d` |

An empty `audio` list is not a miss for a song. Chat with vision is not generation. Transcribe is not TTS. `ffmpeg_encode` is transcode, not a generative model.

Never curl FlowStudio, ComfyUI, or `router local` to generate. Router owns GPU scheduling.

Image, video, audio, and glb/gltf/obj preview under the reply after landing. Never reply with only a hyperlink.
