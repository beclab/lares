# Deliver into the conversation

Load this after **any** successful generate — Router, FlowStudio-via-Router, or a fallback that actually wrote a file. The user did not have to say "preview".

Do not reply until one drive tool has published a path. `url_fetch` and `ffmpeg_encode` already publish; `workspace_publish` is for a file that already exists. Do not call `workspace_publish` after `url_fetch` or `ffmpeg_encode`.

## How the bytes arrive

Pick the first row that matches. Never curl, wget, or open FlowStudio / ComfyUI to "just download it".

| What you have | Do this |
|---|---|
| `b64_json`, raw base64, or a `data:` URL | `url_fetch` a `data:<mediaType>;base64,...` URL. Give `destination` a real name and extension (`downloads/portrait.png`, `outputs/line.mp3`). |
| Public `https://` file URL (no credentials) | `url_fetch` that URL. Same destination rule if the path has no extension. |
| Workspace file (`router call … --out`, a write, a CLI download into the session cwd) | `workspace_publish` that relative path. `--out` does **not** publish by itself. |
| Olares files path (`drive/…`, `sync/…`, …) | `workspace_publish` that files path. Do not `drive_fetch` only to preview. |
| Cluster / internal URL (`flowstudio-svc`, `*.svc`, RFC1918, `localhost`, `/api/v1/generations/…/content`) | **Do not** `url_fetch` — it will refuse a non-public host. **Do not** curl it either (same boundary). If the Router JSON already has `b64_json` / `data:`, use that row instead. If `router call --help` offers `--out` for this verb, write a workspace file and `workspace_publish`. If the only handle is the internal URL, say the file cannot be fetched for preview and ask for a workspace path or public URL — do not try the host directly. |

## After the tool returns

Name the published workspace or files path in markdown inline code, in the **closing** sentences, and stop there. Mid-reply mentions leave the player stranded below later prose.

- Image / video / audio: the conversation plays them under the reply.
- 3D: land `glb` when the backend can emit it. The conversation and the preview tab mount a Three.js viewer for `glb` / `gltf` / `obj`. `gltf` with sidecar `.bin` / textures often cannot load from the raw-file URL. Other mesh types stay a file chip.
