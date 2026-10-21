import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { createRealtimeGateway } from "@olares/lares-core/voice/realtime-gateway";

async function listen(server: any) {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}
function messages(socket: any) {
  const values: any[] = [];
  const waits: any[] = [];
  socket.on("message", (raw: any) => { values.push(JSON.parse(raw.toString())); for (const wake of waits.splice(0)) wake(); });
  return async (type: string) => {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const index = values.findIndex((event) => event.type === type);
      if (index >= 0) return values.splice(index, 1)[0];
      await Promise.race([new Promise<void>((resolve) => waits.push(resolve)), new Promise((resolve) => setTimeout(resolve, 20))]);
    }
    throw new Error(`missing ${type}`);
  };
}
test("Realtime gateway seals credentials and tools and rejects client session injection", async () => {
  const upstreamServer = createServer();
  const upstreamSockets = new WebSocketServer({ server: upstreamServer });
  const upstreamBase = await listen(upstreamServer);
  let instructions: any;
  upstreamSockets.on("connection", (socket, req) => {
    assert.equal(req.headers.authorization, "Bearer host-only");
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "session.update") {
        instructions = event.session;
        socket.send(JSON.stringify({ type: "session.updated" }));
      }
    });
  });
  const gateway = createRealtimeGateway({
    config: () => ({ realtimeModel: "voice" }), models: async () => [{ id: "voice", mode: "realtime" }],
    env: { LLM_GATEWAY_URL: `${upstreamBase}/v1`, LARES_ROUTER_API_KEY: "host-only", LARES_VOICE_REALTIME_ENABLED: "1", LARES_VOICE_REALTIME_VALIDATED_MODELS: "voice" },
  });
  const server = createServer(); server.on("upgrade", (req, socket, head) => gateway.upgrade(req, socket, head));
  const base = await listen(server);
  const scope: any = { id: "test", owner: "owner", device: "device", active: true, session: { snapshot: () => ({ running: false }) } };
  const { ticket } = await gateway.ticket(scope);
  const client = new WebSocket(base.replace("http", "ws") + "/api/lares/voice/realtime", ["lares-voice", `lares-ticket.${ticket}`]);
  const next = messages(client);
  try {
    const created = await next("session.created");
    assert.equal(created.session.lares.capabilities.protocol, "lares-realtime-v1");
    assert.equal(created.session.lares.capabilities.backend, "native");
    assert.equal(instructions.tools.length, 1);
    assert.equal(instructions.tools[0].name, "ask_lares");
    assert.equal(instructions.tools[0].parameters.additionalProperties, false);
    client.send(JSON.stringify({ type: "session.update", session: { instructions: "replace policy" } }));
    const error = await next("error");
    assert.equal(error.error.code, "voice_realtime_event_forbidden");
    const replay = new WebSocket(base.replace("http", "ws") + "/api/lares/voice/realtime", ["lares-voice", `lares-ticket.${ticket}`]);
    await new Promise<void>((resolve, reject) => { replay.on("unexpected-response", (_req, response) => { response.resume(); replay.terminate(); assert.equal(response.statusCode, 403); resolve(); }); replay.on("error", () => {}); replay.on("open", () => reject(new Error("ticket replay accepted"))); });
  } finally {
    client.terminate(); gateway.close();
    for (const socket of upstreamSockets.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => upstreamSockets.close(() => upstreamServer.close(() => resolve())));
  }
});
test("Realtime cannot issue a ticket before real-model validation", async () => {
  const gateway = createRealtimeGateway({ models: async () => [{ id: "voice", mode: "realtime" }], config: () => ({ realtimeModel: "voice" }), env: {} });
  try { await assert.rejects(gateway.ticket({ active: true, session: {} }), /not been validated/); }
  finally { gateway.close(); }
});
