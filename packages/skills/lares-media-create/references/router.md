# Router: probe and call

Load this when checking whether Router can produce the requested image, video, audio, or 3D, and when actually starting the job.

Flags and extra verbs: `olares-cli router --help` and `olares-cli router call --help`. Calling details for chat / embed / transcribe / speak / OCR live in [`olares-router`](../../olares-router/SKILL.md) — load that skill for credential and diagnosis rules, not for this decision order.

## Probe

```bash
olares-cli router status
olares-cli router list -o json
olares-cli router list --mode image_generation -o json
olares-cli router list --mode audio -o json
olares-cli router default show
```

- **`status` first.** "Not installed" on a non-admin profile means Router is invisible, not that generation is impossible by other means later in the ladder.
- A matching **enabled** row is a hit: `image_generation` for pictures (and for FlowStudio video / 3D / generative audio, which share that provider mode), or `audio` plus TTS flags (`supports_tts` / `supports_tts_clone` / `supports_tts_dialogue`) for speech.
- `router list --disabled` finds a row that exists but is off; enable it rather than skipping to FlowStudio HTTP.
- No matching row → return to the front door and continue at FlowStudio.

## Call (always Router)

Never curl FlowStudio (`flowstudio-svc`, `/v1/images/generations`, `/api/v1/generations`), ComfyUI, or `router local` just to generate. Those paths skip Router's GPU queue.

```bash
olares-cli router call --help
```

Use the verb that matches the mode:

```bash
olares-cli router call speak "hello" --out speech.mp3 --model <provider>/<model>
```

`--model` is `<provider>/<model>` as `router list` prints it. Omit it only when `default show` already names this mode.

For `image_generation` rows (cloud image models **and** FlowStudio workflows registered on Router):

- Prefer a `router call` verb if `--help` lists one for this mode. Prefer `--out` so landing is a workspace file.
- Image-shaped OpenAI: POST to **Router's** data plane `/v1/images/generations` (the gateway `olares-cli router status` reports, or in-cluster `LLM_GATEWAY_URL`). Pass `model` as `router list` printed it. This is still Router, not FlowStudio's shared entrance. That endpoint returns image `b64_json` — do not use it as the video / 3D / audio path. Those families still go through Router; pick the verb or `--out` that yields that file type.

Then land the file with [deliver.md](deliver.md). A Router JSON body or `--out` path is not preview.

## Failures

A refusal on mode / model / endpoint means this step is not a hit — continue the front-door ladder. Auth, quota, and "application not answering" are Router diagnosis (`router usage list`, `router provider get`), not a reason to call FlowStudio directly.
