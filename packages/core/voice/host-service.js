import { createVoiceAgentSession } from "./agent-session.js";

const failure = (code, status) => Object.assign(new Error(code), { code, status });

/** Session creation and task policy belong to core, not transport routes. */
export function createVoiceHostService(api, { env = process.env, metric = () => {} } = {}) {
  return {
    async open(scope, body) {
      if (scope.active) throw failure("voice_session_active", 409);
      if (body.sessionId != null && (typeof body.sessionId !== "string" || !body.sessionId || body.sessionId.length > 256)) throw failure("voice_session_invalid", 400);
      if (body.sessionId) await api.inspect(body.sessionId);
      await scope.session?.close();
      scope.session = createVoiceAgentSession(api, {
        sessionId: body.sessionId || null, preset: env.LARES_VOICE_AGENT_PRESET || undefined,
        metric: (fields) => metric({ voiceId: scope.id, ...fields }),
      });
      await scope.session.open();
      scope.active = true; scope.readAloud = body.readAloud === true;
      return scope.session.snapshot();
    },
    async prompt(scope, body) {
      if (!scope.active || !scope.session) throw failure("voice_session_closed", 409);
      if (typeof body.text !== "string" || body.text.length > 16_000 || typeof body.requestId !== "string" || !body.requestId || body.requestId.length > 128) throw failure("voice_session_invalid", 400);
      return scope.session.submit(body.text, body.requestId, body.mode);
    },
    state: (scope) => ({ ...scope.session?.snapshot(), active: scope.active === true }),
    resume: (scope) => scope.session?.resume(),
    cancel: (scope) => scope.session?.cancel(),
    async close(scope) {
      scope.active = false; scope.realtimeSocket?.close();
      await scope.realtimeAudio?.stop();
      await scope.session?.close();
    },
  };
}
