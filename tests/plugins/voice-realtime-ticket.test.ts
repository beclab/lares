import assert from "node:assert/strict";
import test from "node:test";
import { registerRealtime } from "../../packages/web/composer-voice/host/realtime.js";

function host() {
  const unifiedTickets: string[] = [];
  const unified = {
    accepts: () => false,
    ticket(scope: { voiceConfig?: { preset?: string } }) {
      unifiedTickets.push(scope.voiceConfig?.preset || "");
      return { ticket: "pipeline" };
    },
    upgrade() {},
    close() {},
  };
  const registered = registerRealtime(
    { webServer: { registerUpgrade: () => () => {} } },
    { record() {} },
    unified,
  );
  return { registered, unifiedTickets };
}

function scope(backend: string, preset: string) {
  return { active: true, session: {}, voiceConfig: { backend, preset } };
}

test("dictation takes a pipeline ticket and native realtime keeps its preset gate", async () => {
  const { registered, unifiedTickets } = host();
  try {
    assert.deepEqual(await registered.ticket(scope("pipeline", "dictation")), { ticket: "pipeline" });
    assert.deepEqual(await registered.ticket(scope("pipeline", "direct")), { ticket: "pipeline" });
    assert.deepEqual(unifiedTickets, ["dictation", "direct"]);
    await assert.rejects(
      registered.ticket(scope("realtime", "dictation")),
      (error: any) => error?.code === "voice_preset_backend_unsupported",
    );
  } finally {
    registered.dispose();
  }
});
