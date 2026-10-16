import { createRealtimeGateway } from "@olares/lares-core/voice/realtime-gateway";
import { readConfig } from "@olares/lares-core/voice/config";
import { openRealtimeHostAudio } from "@olares/lares-core/voice/service";
import { listModels } from "@olares/lares-core/router/stt";

export function registerRealtime(ctx, service) {
  const gateway = createRealtimeGateway({ models: () => listModels({ refresh: true }), config: readConfig, audio: openRealtimeHostAudio, record: (scope, role, text, turnId) => service.record(scope, role, text, turnId) });
  const unregister = ctx.webServer.registerUpgrade({ path: "/api/lares/voice/realtime", handler: (req, socket, head) => gateway.upgrade(req, socket, head) });
  return { ticket: (scope) => gateway.ticket(scope), dispose() { unregister(); gateway.close(); } };
}
