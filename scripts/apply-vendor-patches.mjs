import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const patches = [
  { markerFile: "node_modules/@deepseek-ai/dsh-llm/lib/index.js", marker: 'config.provider === "olares-router" ? void 0 : reasoning.defaultEffort', patch: "patches/dsh-router-default-effort.patch" },
  { markerFile: "node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js", marker: "if (!await authorizedChatModel(selection)) return false;", patch: "patches/dsh-model-admission.patch" },
  { markerFile: "node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js", marker: "...routerReasoningInfo(provider, model", patch: "patches/dsh-router-reasoning.patch" },
  {
    markerFile: "node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js",
    marker: "const bindBeforeLeave =",
    patch: "patches/dsh-settings-leave-guard.patch",
  },
  {
    markerFile: "node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js",
    marker: "const compactModelLabel =",
    patch: "patches/dsh-model-compact-label.patch",
  },
  { markerFile: "node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js", marker: "const missingModelLabel =", patch: "patches/dsh-model-missing-state.patch" },
  {
    markerFile: "node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js",
    marker: 'renderSlotChain("conversation.input.primary"',
    patch: "patches/dsh-composer-primary-extension.patch",
  },
  {
    markerFile: "node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js",
    marker: '"data-composer-overlay": true',
    patch: "patches/dsh-composer-overlay-anchor.patch",
  },
  {
    markerFile: "node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js",
    marker: '"data-composer-actions": true',
    patch: "patches/dsh-composer-surface-attributes.patch",
  },
  {
    markerFile: "node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js",
    marker: "setExternalActivity(source, target, active)",
    patch: "patches/dsh-conversation-external-activity.patch",
  },
  {
    markerFile: "node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js",
    marker: 'renderSlotChain("conversation.chat.timeline"',
    patch: "patches/dsh-chat-timeline-extension.patch",
  },
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
  { markerFile: "node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js", marker: "routerRows = routerReasoningSnapshot()", patch: "patches/dsh-router-native-efforts.patch" },
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
