# Router shim: when `media_generate` is absent

Load this only when `media_generate` is not in your tool list. An error from that tool is not absence — handle it with the Failures table in SKILL.md.

Produce steps 1–4 are unchanged: same catalog read, same row, same `params`. This file replaces step 5 and step 6 only.

## Submit

POST to `$LARES_LLM_BASE_URL` (in-process shim; default `http://127.0.0.1:$PORT/llm/v1`) with `prefer: respond-async`. The route follows the row's `mode` and the operation:

| Row `mode` + operation | Shim route | Images go in |
|---|---|---|
| `image_generation`, edit | `/generations` | `inputs.images`; optional `inputs.mask` |
| `image_generation`, generate (including a video scene parked there) | `/images/generations` | — |
| `video_generation` | `/videos` | `reference_images` |
| `music_generation` | `/music/generations` | — |
| `model3d_generation` | `/generations` | — |

An image edit is never posted to `/images/generations`, and a real `video_generation` / `music_generation` row is never posted there either.

The body is the same one the tool would build: `model`, `operation` when the table names one, and every input the workflow takes under `flowstudio.params`, keyed by `flowstudio.parameters[].key` and unchanged — the prompt under its `associateRole: "prompt"` key, and each media slot as a `drive/Home/FlowStudio/…` Files path — FlowStudio reads only that folder, so a workspace file is first copied into `Home/FlowStudio/uploads` (mounted in Lares at `$LARES_FLOWSTUDIO_FILES_DIR/uploads`). Router checks three top-level fields before it forwards, and FlowStudio never reads them: a `prompt` (send the same text), `inputs.images` / `reference_images` on an edit-only row, and `inputs.mask` when a required `editMask` slot exists — send a 1×1 PNG data URL for the last two. Nothing else goes at the top level.

For a row without `flowstudio.parameters` (a cloud model), images travel as data URLs instead, as below.

Images are `data:image/<subtype>;base64,…` URLs built from the workspace file, with its real subtype — never a bare path or an `https://` link. `--rawfile` keeps a large image off the command line:

```bash
{ printf 'data:image/png;base64,'; base64 < "$SOURCE_IMAGE" | tr -d '\n'; } > /tmp/src.url
jq -n --arg m "<provider>/<model>" --arg p "<prompt>" --rawfile i /tmp/src.url \
  --argjson params '{"<prompt key>":"<prompt>","<parameter key>":"<value>"}' \
  '{model:$m, prompt:$p, operation:"edit", inputs:{images:[$i]}, flowstudio:{params:$params}}' |
curl -sS -X POST "$LARES_LLM_BASE_URL/generations" \
  -H 'content-type: application/json' -H 'prefer: respond-async' --data-binary @-
```

For I2V / R2V swap the route to `/videos`, drop `operation`, and send `reference_images:[$i]` instead of `inputs`. Without images, drop `--rawfile` and the image field. A row without `flowstudio.parameters` drops `flowstudio`.

## Wait

Submit once. Use a long bash timeout and poll `GET $LARES_LLM_BASE_URL/generations/<id>` every few seconds until `status` is `completed`, `failed`, or `canceled`. A dropped connection or a 503 while polling is not a failure — keep polling the same id; never submit again. A failed status goes to the Failures table in SKILL.md.

## Land

Each output of the completed poll carries `files_path`, the Olares files address of the original bytes (`drive/Home/FlowStudio/outputs/…`). `workspace_publish` that address and stop — see [deliver.md](deliver.md). Do not GET `/content`, write `outputs/`, or copy the file.

An older Router may omit `files_path`. The output is still addressable by its id: `olares-cli files cat drive/Data/flowstudio/userData/<username>/comfyui/outputs/.by-id/<output id>` prints one line, the files address to publish. That is the only reason to read that directory.

If the shim itself is down, stop: tell the user generation is unavailable right now and name the error.
