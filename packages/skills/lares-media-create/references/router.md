# Router: probe and call

Load this when checking whether Router can produce the requested image, video, audio, or 3D, and when actually starting the job.

Flags and extra verbs: `olares-cli router --help` and `olares-cli router call --help`. Calling details for chat / embed / transcribe / speak / OCR live in [`olares-router`](../../olares-router/SKILL.md) — load that skill for credential and diagnosis rules, not for this decision order.

## Probe

Use the **front-door family table**. `audio` is speech (TTS / STT). Songs use `music_generation`. Do not probe `--mode audio` for music, and do not treat an empty `audio` list as “no music”.

```bash
olares-cli router status
olares-cli router list -o json
olares-cli router list --mode image_generation -o json
olares-cli router list --mode video_generation -o json
olares-cli router list --mode music_generation -o json
olares-cli router list --mode audio -o json
olares-cli router default show
```

- **`status` first.** "Not installed" on a non-admin profile means Router is invisible, not that generation is impossible by other means later in the ladder.
- A matching **enabled** row for **this family** is a hit. Filter `router list -o json` (or `--mode`) by that mode — not by a neighbouring family.
- Speech still needs TTS flags on an `audio` row (`supports_tts` / `supports_tts_clone` / `supports_tts_dialogue`). A music row does not.
- FlowStudio scenes for video / 3D / `output=audio` may also show up under the FlowStudio `image_generation` provider. That is a second place to look **after** the family's own mode is empty — never instead of `video_generation` / `music_generation`.
- `router list --disabled` finds a row that exists but is off; enable it rather than skipping to FlowStudio HTTP.
- No matching row → return to the front door and continue at FlowStudio.

## Call (always Router)

Never curl FlowStudio (`flowstudio-svc`, `/v1/images/generations`, `/api/v1/generations`), ComfyUI, or `router local` just to generate. Those paths skip Router's GPU queue.

```bash
olares-cli router call --help
```

Pick the verb for **this family's mode**. `speak` is TTS only — never use it for music.

```bash
olares-cli router call image "<prompt>" --out out.png --model <provider>/<model>
olares-cli router call video "<prompt>" --out out.mp4 --model <provider>/<model>
olares-cli router call speak "hello" --out speech.mp3 --model <provider>/<model>
```

`--model` is `<provider>/<model>` as `router list` prints it. Omit it only when `default show` already names this mode.

A missing CLI verb is **not** a missing catalog row. If `--help` has `image` / `video` / `speak` but no music verb, `music_generation` is still a step-1 hit: use whichever verb `--help` adds for that mode, or Router's data plane for that mode (gateway from `router status`, or in-cluster `LLM_GATEWAY_URL`). Prefer `--out` so landing is a workspace file. Do not fall through to “no music model”.

For `image_generation` rows (cloud image models **and** FlowStudio workflows registered on Router):

- Prefer a `router call` verb if `--help` lists one for this mode. Prefer `--out` so landing is a workspace file.
- Image-shaped OpenAI: POST to **Router's** data plane `/v1/images/generations` (the gateway `olares-cli router status` reports, or in-cluster `LLM_GATEWAY_URL`). Pass `model` as `router list` printed it. This is still Router, not FlowStudio's shared entrance. That endpoint returns image `b64_json` — do not use it as the video / 3D / music path. Those families still go through Router; pick the verb or `--out` that yields that file type.

Then land the file with [deliver.md](deliver.md). A Router JSON body or `--out` path is not preview.

## Failures

A refusal on mode / model / endpoint means this step is not a hit — continue the front-door ladder. Auth, quota, and "application not answering" are Router diagnosis (`router usage list`, `router provider get`), not a reason to call FlowStudio directly.
