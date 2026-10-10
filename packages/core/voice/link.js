import { VoiceError } from "../router/stt.js";
import { askAgent, liveAgent } from "./agent.js";

const SCAN_WAIT_MS = 45_000;
const CONNECT_WAIT_MS = 90_000;
const ADDRESS = /^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/;

export function normalizeBluetoothAddress(value) {
  const address = String(value ?? "").trim().toUpperCase();
  if (!ADDRESS.test(address)) {
    throw new VoiceError("voice_bluetooth_invalid", 400, "invalid bluetooth address");
  }
  return address;
}

export function normalizeBluetoothDevices(raw) {
  if (!Array.isArray(raw)) return [];
  const devices = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const address = String(item.address ?? "").trim().toUpperCase();
    if (!ADDRESS.test(address)) continue;
    const name = String(item.name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
    devices.push({
      address,
      name: name || address,
      paired: item.paired === true,
      connected: item.connected === true,
    });
  }
  return devices;
}

/** Bring the headset up. No agent means this machine has nothing to prepare. */
export async function ensureBluetoothReady(options = {}) {
  if (!await liveAgent(options)) return { ready: true, skipped: true };
  const result = await askAgent("ensure", {}, options);
  if (result.ready) return result;
  throw new VoiceError("voice_bluetooth_not_ready", 503, result.error || "bluetooth headset is not capturing");
}

/** Devices advertising during this scan, including ones already connected. */
export async function scanBluetoothDevices(options = {}) {
  const result = await askAgent("scan", {}, { ...options, timeoutMs: options.timeoutMs ?? SCAN_WAIT_MS });
  if (result.op !== "scan") {
    throw new VoiceError("voice_bluetooth_unavailable", 503, "bluetooth agent does not support scanning");
  }
  if (result.error) {
    const code = result.code === "voice_bluetooth_unavailable"
      ? "voice_bluetooth_unavailable"
      : "voice_bluetooth_scan_failed";
    throw new VoiceError(code, code === "voice_bluetooth_unavailable" ? 503 : 502, String(result.error));
  }
  return { devices: normalizeBluetoothDevices(result.devices) };
}

export async function connectBluetoothDevice(address, options = {}) {
  const mac = normalizeBluetoothAddress(address);
  const result = await askAgent("connect", { address: mac }, {
    ...options,
    timeoutMs: options.timeoutMs ?? CONNECT_WAIT_MS,
  });
  if (result.op !== "connect") {
    throw new VoiceError("voice_bluetooth_unavailable", 503, "bluetooth agent does not support connecting");
  }
  if (!result.connected) {
    const code = result.code === "voice_bluetooth_unavailable"
      ? "voice_bluetooth_unavailable"
      : "voice_bluetooth_connect_failed";
    throw new VoiceError(code, code === "voice_bluetooth_unavailable" ? 503 : 502, result.error || "bluetooth connect failed");
  }
  const [device] = normalizeBluetoothDevices([{
    address: result.address || mac,
    name: result.name,
    paired: true,
    connected: true,
  }]);
  return device ?? { address: mac, name: mac, paired: true, connected: true };
}

export async function bluetoothRequest(body, options) {
  const op = body && typeof body === "object" ? body.op : "";
  if (op === "scan") return scanBluetoothDevices(options);
  if (op === "connect") return connectBluetoothDevice(body.address, options);
  throw new VoiceError("voice_bluetooth_invalid", 400, "unknown bluetooth operation");
}
