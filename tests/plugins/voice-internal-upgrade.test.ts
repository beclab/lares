import assert from "node:assert/strict";
import test from "node:test";
import { internalRealtimeUpgrade, publishRealtimeUpgrade } from "@olares/lares-core/voice/internal-upgrade";

test("the internal entrance forwards only Bearer realtime upgrades to the voice host", () => {
  const seen: string[] = [];
  const socket = (name: string) => ({ end: (text: string) => seen.push(`${name}:${text.split("\r\n")[0]}`) });
  const unpublish = publishRealtimeUpgrade((req: any) => seen.push(`voice:${req.url}`));
  try {
    internalRealtimeUpgrade({ url: "/api/lares/voice/realtime?model=voice-chat", headers: { authorization: "Bearer k" } } as any, socket("a") as any, Buffer.alloc(0));
    internalRealtimeUpgrade({ url: "/api/lares/voice/realtime", headers: {} } as any, socket("b") as any, Buffer.alloc(0));
    internalRealtimeUpgrade({ url: "/api/lares/voice/stream", headers: { authorization: "Bearer k" } } as any, socket("c") as any, Buffer.alloc(0));
  } finally { unpublish(); }
  internalRealtimeUpgrade({ url: "/api/lares/voice/realtime", headers: { authorization: "Bearer k" } } as any, socket("d") as any, Buffer.alloc(0));
  assert.deepEqual(seen, ["voice:/api/lares/voice/realtime?model=voice-chat", "b:HTTP/1.1 404 Not Found", "c:HTTP/1.1 404 Not Found", "d:HTTP/1.1 404 Not Found"]);
});
