---
name: lares-media-create
version: 0.6.0
description: "Produce or edit an image, video, music, speech, or 3D model through Router with the media_generate tool: list the family, pick one catalog row, submit once, and the output is published. Use for 生成图片, 编辑图片, 改图, 修图, 生成视频, 文生视频, 图生视频, 生成音乐, 语音合成, 生成3D, text-to-image, image edit, T2V, I2V, R2V, TTS, FlowStudio 场景/工作流. Not for Router install, catalog sync, or GPU diagnosis."
metadata:
  requires:
    bins: ["curl", "jq"]
---

# lares-media-create

A generate, create, or edit request is **produce**, not platform diagnosis. A FlowStudio scene or workflow is this skill. Do not narrate this protocol and do not load other skills.

## Boundaries

These hold for every step and every reference file; they are not repeated there.

- Generate only through the `media_generate` tool, or — only when that tool is not in your tool list — the in-process shim `$LARES_LLM_BASE_URL` ([router.md](references/router.md)). Both stamp the logged-in Olares user, so the job and its files belong to this person.
- Never call FlowStudio, ComfyUI, `router local`, Router's data plane (`$LLM_GATEWAY_URL`), or `olares-cli router call` to generate, list scenes, map a UUID to a title, or fetch a file. Lares refuses those shell calls; a refusal is not a cue to try another route.
- Never repair the catalog (`provider sync-models`, `model add` / `delete` / `update`) during produce. That is [flowstudio.md](references/flowstudio.md), and only for an empty family.
- Do not run `--help`, grep `/app` or the Router source, or browse the drive for a file.

## Families

The catalog `mode` is the key; the user's words ("音频", "声音") are not.

| User wants | Row `mode` | `creative.operations` has |
|---|---|---|
| Text-to-image | `image_generation` | `generate` |
| Image edit (source image supplied) | `image_generation` | `edit` |
| Video: T2V, I2V, R2V | `video_generation` | — |
| Music, song, generative audio | `music_generation` | — |
| 3D, mesh, glb | `model3d_generation` | — |
| Speech / TTS | `audio` with a TTS model | not `media_generate` — see [Speech](#speech) |

An empty `audio` list is not a miss for a song. Chat with vision is not generation; transcription is not TTS; `ffmpeg_encode` is a transcode, not a model.

## Produce

1. **Family.** Map the ask to one row of the table.
2. **List.** One catalog read, through the shim:

   ```bash
   curl -sS "$LARES_LLM_BASE_URL/models?detail=capabilities"
   ```

   Keep rows whose `mode` is the family. For video only, if none remain, also consider `image_generation` rows whose `name` is clearly a video scene (FlowStudio sometimes parks video there); such a row keeps `mode: image_generation`.
3. **Pick one enabled row.**
   - The user named a scene → the row whose `name` matches **is** the pick. Never swap it for one that "fits better".
   - Otherwise the row's `creative.operations` must contain the operation from the table (`edit` / `generate`). A Router that omits `creative`: accept a FlowStudio row only — for edit its `canonical_fields` has `inputs.images` and its `name` says image edit; for text-to-image it has no `inputs.images` and its `name` says text to image. Never apply this to a cloud row.
   - Skip a row whose `name` is clearly another family. When the user supplied no media, prefer a prompt-only scene.
   - `model` is `<provider>/<model>` exactly as listed; FlowStudio's model half is usually a UUID and **is** the id. Refer to the row by its `name`.
4. **Params.** For a FlowStudio row, `flowstudio.parameters` is FlowStudio's own list of every input this workflow takes: its prompt (the entry with `associateRole: "prompt"`), its controls, and its media slots (entries with `media` and `valueFormat`). Put every value in `params`, keyed by that list's `key`, exactly as FlowStudio defines it; the tool sends it as `flowstudio.params` unchanged. Put the user's prompt, unchanged, under the prompt key. Match the user's words to each entry's `label`; for a select send the option's `value`. A media slot takes the user's file as a path: a workspace file (the tool copies it into `Home/FlowStudio/uploads`, the folder FlowStudio reads) or a `drive/Home/FlowStudio/…` address such as an earlier output; `filesPath` is one path, `filesPathBySlot` is `{option value: path}`, `sourceAndMask` is `{source, mask}`. Never invent a key, and add nothing the list does not name. A row without `flowstudio.parameters` takes no `params`. A detail the row cannot express is dropped and said in the reply — it is never a reason to change rows. Leave any seed parameter out so each run is fresh ("再来一张" is the same call again).
5. **Call `media_generate` once** with the row's `model` and `params`. For a row without `flowstudio.parameters` (a cloud model), pass `prompt`, and `reference_images` / `mask_image` for an edit or I2V instead. The tool reads the row from Router, takes the route and the operation from it, and fills the top-level fields Router checks before it forwards; FlowStudio never reads those. FlowStudio checks everything else — required slots, file types, values — and its error names the key; fix the call from that once. An I2V or edit ask without a file → ask for one, or say you will first generate one with an `image_generation` row; never fall back to a T2V row.
6. **Reply.** The tool waits however long the run takes and publishes every output; the preview appears under the reply. Do not `workspace_publish`, download, copy, or link its files again, and do not claim success beyond what the result lists.

A generation an earlier turn started is resumed with `generation_id` alone — never submit it again.

## Failures

A `media_generate` error is the Router error. Handle it here; it never means the tool is unavailable, and it is never retried through the shim.

| Error | Do |
|---|---|
| `media_input_required`, `media_input_unsupported`, `media_field_unknown` | Fix the request once in the spelling the error names and call again. If the named field is not one you sent (for example `sref`), the tool built it: report the error text and stop. A second refusal ends the attempt: report the error text. Another row of the same kind needs the same field, so do not hop rows. |
| `upstream_capacity_unavailable`, or `retryable` / a retry-after | The node is short of memory or GPU. Wait the stated seconds (30 if none), call the same row once more, then tell the user the node is busy. Do not fan out to other rows. |
| One row 404, unpublished, or wrong mode | Try the next same-family row. A row the user named only moves after its own call failed, and the reply says which row ran instead. |
| Auth, quota, "application not answering" | Report it; diagnosis is `olares-cli router usage list` / `router provider get`, not a new route. |
| Every same-family row failed, or the list was empty | [flowstudio.md](references/flowstudio.md), then [fallback.md](references/fallback.md). |

## Speech

TTS is not a media generation. POST the TTS row's model to the shim, then `workspace_publish` the file it wrote ([deliver.md](references/deliver.md)); on an HTTP error the body is the Router error — report it, do not publish it:

```bash
jq -n --arg m "<provider>/<model>" --arg t "<text>" '{model:$m, input:$t}' |
curl -sS --fail-with-body -X POST "$LARES_LLM_BASE_URL/audio/speech" -H 'content-type: application/json' \
  --data-binary @- -o outputs/speech.mp3
```
