---
name: lares-media-create
version: 0.1.0
description: "Route image, video, audio, and 3D generation through Olares Router so GPU work is scheduled in one place. Probe Router first, then whether FlowStudio is installed, then whether FlowStudio has a matching workflow; only then consider other methods. Use for generate/create 图片, 视频, 音频, 3D, text-to-image, text-to-video, TTS, music, mesh, glb, FlowStudio."
metadata:
  requires:
    bins: ["olares-cli"]
---

# lares-media-create

Read this front door on any **image, video, audio, or 3D generation / creation** task. Load a reference only when that step is the one in front of you.

**Trigger generation through Router.** Router owns GPU scheduling. Calling FlowStudio, ComfyUI, or a local engine yourself starts a second GPU job and collides with whatever Router already launched.

## Decision order

Stop at the first step that can do the job. Do not skip ahead.

1. **Router capability** — does Router already offer this output family? If yes, call through Router. Load [router.md](references/router.md).
2. **FlowStudio installed?** — only if step 1 found nothing. Load [flowstudio.md](references/flowstudio.md).
3. **Matching FlowStudio workflow?** — only if FlowStudio is installed. A match still runs **through Router** (register / sync-models if the catalog is empty), never through FlowStudio HTTP.
4. **Other methods** — only if Router has no row, FlowStudio is absent, or it has no matching workflow. Load [fallback.md](references/fallback.md).
5. **Deliver** — a successful produce is not finished until the file is in this conversation. Load [deliver.md](references/deliver.md) and run that landing **before** the reply. Do not stop at a URL, a job id, or a FlowStudio page.

## Output families

| User wants | Treat as a hit when Router / FlowStudio has |
|---|---|
| Image generate or edit | `mode=image_generation`, or a FlowStudio workflow with `output=image` |
| Video | FlowStudio `output=video` (usually listed under the FlowStudio `image_generation` provider) |
| Speech / TTS | `mode=audio` with TTS flags, via `router call speak` |
| Music / generative audio | FlowStudio `output=audio` |
| 3D / mesh / glb | FlowStudio `output=model3d` |

Chat with vision is not generation. Transcribe is not TTS. `ffmpeg_encode` is transcode / test pattern, not a generative model.

Image, video, audio, and glb/gltf/obj preview under the reply after landing. Never reply with only a hyperlink.
