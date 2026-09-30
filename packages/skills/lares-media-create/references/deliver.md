# Deliver into the conversation

Load this only when the bytes did **not** come from `media_generate` — that tool publishes its own outputs, and publishing them again duplicates the preview. The cases here are the shim path ([router.md](router.md)), speech, and a fallback that wrote a file.

Do not reply until one drive tool has published the output. `url_fetch` and `ffmpeg_encode` publish by themselves; `workspace_publish` is for a file that already exists. Never publish the same bytes twice.

One deliverable per turn: publish what this call returned and stop — not a neighbour, an older generation, or a second copy.

## How the bytes arrive

Take the first row that matches.

| What you have | Do this |
|---|---|
| A poll output's `files_path` (`drive/Home/FlowStudio/outputs/…`) | `workspace_publish` that address. It is the original file, full resolution; the conversation asks the backend for a smaller copy itself. Do not `drive_fetch`, GET `/content`, or copy it into Home or `outputs/`. |
| `b64_json`, raw base64, or a `data:` URL | `url_fetch` a `data:<mediaType>;base64,…` URL with a real `destination` name and extension (`downloads/portrait.png`). |
| A public `https://` file URL (no credentials) | `url_fetch` it, same destination rule. |
| A file this turn wrote into the workspace (e.g. `outputs/speech.mp3`) | `workspace_publish` that relative path. |
| Any other Olares files path (`drive/…`, `sync/…`) | `workspace_publish` it. |
| A cluster or internal URL (`*.svc`, RFC1918, `localhost`, `…/content`) | Do not `url_fetch` it (it refuses non-public hosts) or curl it. Use the `files_path`, `b64_json`, or `.by-id` pointer ([router.md](router.md)) from the same receipt. If none exists, say the generation completed but its file is not reachable for preview, name the generation id, and ask for a workspace path or public URL. That is a complete answer. |

If the receipt does not name the file, do not go looking for it — no `find`, no grep, no `olares-cli files ls` for something with a recent timestamp. A file found by browsing is not evidence that this call produced it.

## After publishing

Stop. The preview under the reply is the surface; do not also write the path as inline code, a hyperlink, or a file chip. Image, video, and audio play there. For 3D, land `glb` when the backend can emit it: the conversation mounts a Three.js viewer for `glb` / `gltf` / `obj`, though a `gltf` with sidecar `.bin` or textures often cannot load. Other mesh types stay a file chip.
