import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("the chart does not mount GPU devices or raise NVENC capabilities", () => {
  const deployment = readFileSync(join(root, "deploy/lares/templates/deployment.yaml"), "utf8");
  assert.doesNotMatch(deployment, /NVIDIA_DRIVER_CAPABILITIES/);
  assert.doesNotMatch(deployment, /\$mountDri/);
  assert.doesNotMatch(deployment, /path: \/dev\/dri/);
  assert.doesNotMatch(deployment, /LIBVA_DRIVER_NAME/);
});

test("the base image ships Debian ffmpeg, not jellyfin or Intel VAAPI", () => {
  const dockerfile = readFileSync(join(root, "Dockerfile.base"), "utf8");
  assert.match(dockerfile, /\bfd-find ffmpeg git\b/);
  assert.match(dockerfile, /fonts-noto-cjk/);
  assert.doesNotMatch(dockerfile, /jellyfin-ffmpeg/);
  assert.doesNotMatch(dockerfile, /NVIDIA_DRIVER_CAPABILITIES/);
  assert.doesNotMatch(dockerfile, /\/opt\/intel-va/);
  assert.doesNotMatch(dockerfile, /mesa-va-drivers/);
});
