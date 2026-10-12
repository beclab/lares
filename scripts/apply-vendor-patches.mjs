import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const patches = [
  {
    markerFile: "node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js",
    marker: "function googleThoughtSignature",
    patch: "patches/pi-ai-openai-completions-thought-signature.patch",
  },
  {
    markerFile: "node_modules/openai/core/error.mjs",
    marker: "function googleArrayError",
    patch: "patches/openai-array-error.patch",
  },
];

for (const item of patches) {
  if (!existsSync(item.markerFile)) {
    console.log(`[lares] vendor patch skipped: ${item.markerFile} is not installed`);
    continue;
  }
  if (readFileSync(item.markerFile, "utf8").includes(item.marker)) continue;
  const result = spawnSync("patch", ["-p1", "--forward", "--input", item.patch], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
