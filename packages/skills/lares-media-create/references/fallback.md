# Other methods

Load this only after **all** of: Router has no matching capability, FlowStudio is not installed (or not usable), and there is no matching FlowStudio workflow.

These paths are **not** GPU-scheduled generation. Do not start a competing GPU process (ComfyUI, a local torch job, FlowStudio engine APIs) to "just get it done".

## What is allowed here

- **Install a real backend**, if the user wants one: `olares-cli market` for `flowstudio`, or `olares-cli router app catalog` / `app install` for an image or audio model application. Ask before install, upgrade, or uninstall. After it is running, go back to the front door and trigger **through Router**.
- **Fetch or transcode an existing file** — `url_fetch`, `drive_fetch`, `ffmpeg_encode`. `ffmpeg_encode` is H.264 transcode or a `testsrc2` pattern, not text-to-image / text-to-video. If a file was written, land it with [deliver.md](deliver.md).
- **Say what is missing** — which family was requested, that Router has no row, and that FlowStudio is absent or has no matching workflow. Offer the install path rather than silently substituting a test pattern.

## What is not

- Curl to FlowStudio or ComfyUI
- Shell / Python GPU inference
- Treating chat+vision as image generation
- Burning GPU on a pattern video when the user asked to *create* footage
