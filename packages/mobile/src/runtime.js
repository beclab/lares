import { createChatRuntime } from "@lares/core/larepass/runtime";
import { createHostClient } from "./host.js";

let current = null;

export function connectChat(ports) {
  const client = createHostClient(ports);
  const key = client.urlFor("/api");
  if (current?.key === key) return current;
  current = Object.assign(createChatRuntime(client), { key });
  return current;
}
