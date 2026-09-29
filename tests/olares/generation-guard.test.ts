import assert from "node:assert/strict";
import test from "node:test";
import {
  decideGenerationGuard,
  detectGenerationBypass,
} from "@olares/lares-core/router/generation-guard";

const env = { LLM_GATEWAY_URL: "https://router.yuxing001.olares.com/v1" };
const allow = { kind: "allow" };

test("the shim and olares-cli stay allowed", () => {
  for (const command of [
    `curl -sS -X POST "$LARES_LLM_BASE_URL/videos" -H 'prefer: respond-async' -d '{}'`,
    `curl -sS "$LARES_LLM_BASE_URL/generations/gen_1"`,
    "curl -sS -X POST http://127.0.0.1:8080/llm/v1/images/generations -d '{}'",
    "olares-cli router call --model Olares/x --prompt cat",
    `curl -sS "$LLM_GATEWAY_URL/models"`,
    "ls outputs/video",
  ]) {
    assert.equal(detectGenerationBypass(command, env), null, command);
  }
});

test("Router's data plane is refused for generation routes", () => {
  for (const command of [
    `curl -X POST "$LLM_GATEWAY_URL/videos" -d '{}'`,
    `curl -X POST "\${LLM_GATEWAY_URL}/images/generations" -d '{}'`,
    "curl -X POST https://router.yuxing001.olares.com/v1/music/generations -d '{}'",
    "curl -X POST http://router-svc.router-shared/v1/generations -d '{}'",
    `python3 -c "import requests; requests.post('https://ROUTER.yuxing001.olares.com/v1/images/generations')"`,
  ]) {
    assert.ok(detectGenerationBypass(command, env), command);
  }
});

test("FlowStudio itself is refused outright", () => {
  for (const command of [
    "curl -X POST http://flowstudio-svc.flowstudio-shared:8080/api/v1/generations -d '{}'",
    "curl http://514f4318.shared.olares.com/api/v1/generations/abc",
    "curl -X POST https://9ff9df3a.yuxing001.olares.com/api/jobs -d '{}'",
  ]) {
    assert.ok(detectGenerationBypass(command, env), command);
  }
});

test("the decision denies shell and fetch calls and keeps other verdicts", () => {
  const bad = `curl -X POST "$LLM_GATEWAY_URL/videos"`;
  assert.equal(decideGenerationGuard({ name: "bash", args: { command: bad }, prior: allow }, env).kind, "deny");
  assert.equal(decideGenerationGuard({ name: "pwsh", args: { command: bad }, prior: allow }, env).kind, "deny");
  assert.equal(
    decideGenerationGuard(
      { name: "web_fetch", args: { url: "http://flowstudio-svc/api/v1/generations" }, prior: allow },
      env,
    ).kind,
    "deny",
  );
  assert.equal(decideGenerationGuard({ name: "bash", args: { command: "ls" }, prior: allow }, env), allow);
  assert.equal(decideGenerationGuard({ name: "str_replace_editor", args: { command: bad }, prior: allow }, env), allow);
  const ask = { kind: "ask" };
  assert.equal(decideGenerationGuard({ name: "bash", args: { command: "ls" }, prior: ask }, env), ask);
  const denied = { kind: "deny", reason: "earlier" };
  assert.equal(decideGenerationGuard({ name: "bash", args: { command: bad }, prior: denied }, env), denied);
});
