# Deliver into the conversation

Load this after **any** successful generate — Router, FlowStudio-via-Router, or a fallback that actually wrote a file. The user did not have to say "preview".

Do not reply until one drive tool has published a path. `url_fetch` and `ffmpeg_encode` already publish; `workspace_publish` is for a file that already exists. Do not call `workspace_publish` after `url_fetch` or `ffmpeg_encode`.

If `--out` did not appear in the workspace, do **not** `find` / grep the filesystem and **never** `router call … --id` or sleep-loop a re-collect. Use that same call's receipt: `files_path` / `filesPath` first, else `b64_json` / `data:` → `url_fetch` as below.

## How the bytes arrive

Pick the first row that matches. Never curl, wget, or open FlowStudio / ComfyUI to "just download it". Never copy a FlowStudio file into Home or `outputs/` so you can preview a second copy.

| What you have | Do this |
|---|---|
| Poll JSON `files_path` / `filesPath` (`drive/Data/flowstudio/…`) | `workspace_publish` that files path. It is the original file on the Olares files backend. Do not `drive_fetch`, do not GET `/content`, do not copy it. |
| `b64_json`, raw base64, or a `data:` URL | `url_fetch` a `data:<mediaType>;base64,...` URL. Give `destination` a real name and extension (`downloads/portrait.png`, `outputs/line.mp3`). |
| Public `https://` file URL (no credentials) | `url_fetch` that URL. Same destination rule if the path has no extension. |
| Workspace file (`router call … --out`, a write, a CLI download into the session cwd) | `workspace_publish` that relative path. `--out` does **not** publish by itself. |
| Olares files path (`drive/…`, `sync/…`, …) | `workspace_publish` that files path. Do not `drive_fetch` only to preview. |
| Cluster / internal URL (`flowstudio-svc`, `*.svc`, RFC1918, `localhost`, `/api/v1/generations/…/content`) | **Do not** `url_fetch` — it will refuse a non-public host. **Do not** curl it either (same boundary). If the poll JSON already has `files_path` / `filesPath`, use that row instead. If it has `b64_json` / `data:`, use that row. If `router call --help` offers `--out` for this verb, write a workspace file and `workspace_publish`. If the only handle is the internal URL, say the file cannot be fetched for preview and ask for a workspace path or public URL — do not try the host directly. |

## After the tool returns

Stop after the drive tool publishes. The turn-tail preview under the reply is the surface. Do **not** also write the path as markdown inline code, a hyperlink, or a trailing file chip — that duplicates the player.

- Image / video / audio: the conversation plays them under the reply.
- 3D: land `glb` when the backend can emit it. The conversation and the preview tab mount a Three.js viewer for `glb` / `gltf` / `obj`. `gltf` with sidecar `.bin` / textures often cannot load from the raw-file URL. Other mesh types stay a file chip.
