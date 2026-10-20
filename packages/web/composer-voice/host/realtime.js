import { createRealtimeGateway } from "@olares/lares-core/voice/realtime-gateway";
import { readConfig } from "@olares/lares-core/voice/config";
import { openRealtimeHostAudio } from "@olares/lares-core/voice/service";
import { listModels } from "@olares/lares-core/router/stt";

/**
 * One endpoint for `lares-realtime-v1`: Bearer voice keys and pipeline tickets reach the unified
 * gateway; tickets for a scope on the native Realtime backend reach the forwarding gateway.
 */
export function registerRealtime(ctx, service, unified) {
  const native = createRealtimeGateway({ models: () => listModels({ refresh: true }), config: readConfig, audio: openRealtimeHostAudio, record: (scope, role, text, turnId, fields) => service.record(scope, role, text, turnId, fields) });
  const unregister = ctx.webServer.registerUpgrade({ path: "/api/lares/voice/realtime", handler: (req, socket, head) => (unified.accepts(req) ? unified : native).upgrade(req, socket, head) });
  return {
    ticket: (scope) => scope.voiceConfig?.backend === "realtime" ? native.ticket(scope) : unified.ticket(scope),
    dispose() { unregister(); native.close(); },
  };
}
