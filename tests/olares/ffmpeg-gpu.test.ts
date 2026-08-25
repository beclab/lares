import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("the chart exposes NVENC driver capabilities and a gated /dev/dri mount", () => {
  const deployment = readFileSync(join(root, "deploy/lares/templates/deployment.yaml"), "utf8");
  assert.match(deployment, /NVIDIA_DRIVER_CAPABILITIES/);
  assert.match(deployment, /compute,utility,video/);
  assert.match(deployment, /\$mountDri/);
  assert.match(deployment, /if \$mountDri \}\}\s+privileged: true/);
  assert.match(deployment, /path: \/dev\/dri/);
});

test("the base image ships jellyfin-ffmpeg and only the VAAPI drivers encode uses", () => {
  const dockerfile = readFileSync(join(root, "Dockerfile.base"), "utf8");
  assert.match(dockerfile, /jellyfin-ffmpeg7/);
  assert.match(dockerfile, /NVIDIA_DRIVER_CAPABILITIES=compute,utility,video/);
  assert.match(dockerfile, /\/opt\/intel-va/);
  assert.match(dockerfile, /mesa-va-drivers/);
  assert.doesNotMatch(dockerfile, /\bvainfo\b/);
  assert.doesNotMatch(dockerfile, /intel-media-va-driver/);
  assert.doesNotMatch(dockerfile, /i965-va-driver/);
  assert.doesNotMatch(dockerfile, /fd-find ffmpeg git/);
});

test("GPU encode does not replace the official shell sandbox", () => {
  const patch = readFileSync(join(root, "packages/plugins/bundle-web/cordis.patch.yml"), "utf8");
  assert.doesNotMatch(patch, /- id: sandbox\s+disabled: true/);
  assert.doesNotMatch(patch, /gpu-sandbox/);
});
