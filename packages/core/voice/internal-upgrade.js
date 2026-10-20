/**
 * The voice host publishes its Bearer-key upgrade here so the internal entrance listener
 * (port 8081, `webhook-internal`) can serve `lares-realtime-v1` to Router without a direct
 * Service route, which the per-user namespace's NetworkPolicy refuses.
 */
let handler = null;

export function publishRealtimeUpgrade(next) {
  handler = next;
  return () => { if (handler === next) handler = null; };
}

export function internalRealtimeUpgrade(req, socket, head) {
  const path = new URL(req.url ?? "/", "http://lares").pathname;
  if (path !== "/api/lares/voice/realtime" || !req.headers.authorization || !handler) {
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    return;
  }
  handler(req, socket, head);
}
