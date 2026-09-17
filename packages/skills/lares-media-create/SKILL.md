---
name: lares-media-create
version: 0.2.1
description: "Produce image, video, audio, or 3D through Router in three steps: list that family, call, land the file. Use for 生成图片, 生成视频, text-to-image, FlowStudio generate. Not for Router install, catalog sync, or GPU diagnosis."
metadata:
  requires:
    bins: ["olares-cli"]
---

# lares-media-create

A generate / create request is **produce**, not platform diagnosis.

Do not load other skills. Do not run `--help`. Do not `provider sync-models`, `model add`, `model delete`, or `market status` unless the family list is **empty**. Do not narrate this protocol.

## Produce

1. Map the ask to **one** family (table below).
2. List that family only:

```bash
olares-cli router list --mode image_generation -o json
```

   Use the matching `--mode`. For video, if that list is empty, also list `image_generation` (FlowStudio sometimes parks video scenes there). Never probe `--mode audio` for a song.

3. Pick one **enabled** row of this family. Prefer a prompt-only scene. Skip a row whose title is clearly another family (a T2V scene is not an image). `--model` is `<provider>/<model>` as listed. A video / Audio-Video / T2V row under `image_generation` is still the video pick: call with the **image** verb and `--out outputs/<name>.mp4`. Do not `router call video` (that posts `/v1/videos`).
4. Call **once** with the user's prompt unchanged and `--out` under `outputs/`. The binary is exactly `olares-cli`. Image `--out` uses `.webp` (FlowStudio often writes WebP; a `.png` suffix fails `read_image`). Set a long bash timeout; do not poll, and do not `router call … --id`.

```bash
olares-cli router call image "<prompt>" --out outputs/<name>.webp --model <provider>/<model>
olares-cli router call video "<prompt>" --out outputs/<name>.mp4 --model <provider>/<model>
olares-cli router call speak "<text>" --out outputs/<name>.mp3 --model <provider>/<model>
```

5. Land the file ([deliver.md](references/deliver.md)). **Images:** before the user-facing reply, `read_image` that workspace file; if the pixels are unrelated to the prompt, one more `router call` with the **same meaning in English**, land again, then reply. **Video / audio / 3D:** publish the file; do not `read_image` a video. Do not claim success from the filename or the prompt.

A **single-row** failure (404 unpublished, wrong mode) is still this step: try the **next same-family row**. It is not “Router cannot generate”. Do not sync or rewrite the catalog. Language mismatch is the English retry above, not a model switch. Never `--id` refetch.

Call details and data-plane fallback: [router.md](references/router.md) — only if the verb or `--out` above cannot run.

Empty list, or every same-family row failed: [flowstudio.md](references/flowstudio.md). If that cannot help: [fallback.md](references/fallback.md).

## Families

Router **mode** is the catalog key. User words like “音频 / 声音” are not that key.

| User wants | Router mode | Also a hit |
|---|---|---|
| Image generate or edit | `image_generation` | FlowStudio `output=image` |
| Video | `video_generation` | FlowStudio `output=video` (may also appear under the FlowStudio `image_generation` provider) |
| Speech / TTS | `audio` with TTS flags | `router call speak` |
| Music / song / generative audio | `music_generation` | FlowStudio `output=audio` |
| 3D / mesh / glb | — | FlowStudio `output=model3d` |

An empty `audio` list is not a miss for a song. Chat with vision is not generation. Transcribe is not TTS. `ffmpeg_encode` is transcode, not a generative model.

Never curl FlowStudio, ComfyUI, or `router local` to generate. Router owns GPU scheduling.

Image, video, audio, and glb/gltf/obj preview under the reply after landing. Never reply with only a hyperlink.
