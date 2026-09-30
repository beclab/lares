# Other methods

Load this only after [flowstudio.md](flowstudio.md) found nothing: Router has no row for the family, and FlowStudio is absent, stopped, or has no matching scene.

Nothing here is generation. Never start a competing GPU job (ComfyUI, local torch, FlowStudio engine APIs) to "just get it done" — Router owns GPU scheduling.

## Allowed

- **Offer a real backend.** Install, upgrade, or uninstall only after the user agrees: `olares-cli market` for `flowstudio`, or `olares-cli router app catalog` / `app install` for an image or audio model application. Once it runs, go back to produce.
- **Fetch or transcode an existing file** with `url_fetch`, `drive_fetch`, or `ffmpeg_encode`, then land it with [deliver.md](deliver.md). `ffmpeg_encode` is an H.264 transcode or a `testsrc2` pattern, never text-to-image or text-to-video.
- **Say what is missing:** the family asked for, that Router has no row, and what FlowStudio lacks — with the install path, rather than a silent substitute.

## Not allowed

- Shell or Python GPU inference.
- Chat with vision presented as image generation.
- A pattern video when the user asked to *create* footage.
