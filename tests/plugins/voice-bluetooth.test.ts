import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { VoiceError } from "@olares/lares-core/router/stt";
import {
  connectBluetoothDevice,
  ensureBluetoothReady,
  normalizeBluetoothDevices,
  scanBluetoothDevices,
} from "@olares/lares-core/voice/link";
import { openBluetoothPlayback, playBluetoothAudio } from "@olares/lares-core/voice/session";

const NOW = 1_700_000_000_000;

function liveAgent(dir: string) {
  writeFileSync(join(dir, "agent.json"), JSON.stringify({ at: NOW / 1000 }));
}

function answerOnSleep(dir: string, body: (request: { id: string; op: string; address?: string; file?: string }) => Record<string, unknown>) {
  return async () => {
    const request = JSON.parse(readFileSync(join(dir, "request.json"), "utf8"));
    writeFileSync(join(dir, "result.json"), JSON.stringify({ id: request.id, ...body(request) }));
  };
}

test("device list drops bad addresses and control characters", () => {
  assert.deepEqual(normalizeBluetoothDevices([
    { address: "aa:bb:cc:dd:ee:ff", name: "Buds\nPro", paired: false, connected: true },
    { address: "not-a-mac", name: "nope" },
    { address: "11:22:33:44:55:66", name: "" },
  ]), [
    { address: "AA:BB:CC:DD:EE:FF", name: "BudsPro", paired: false, connected: true },
    { address: "11:22:33:44:55:66", name: "11:22:33:44:55:66", paired: false, connected: false },
  ]);
});

test("recording proceeds when no bluetooth agent is running", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lares-bt-"));
  try {
    assert.deepEqual(await ensureBluetoothReady({ dir, now: () => NOW }), { ready: true, skipped: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scan asks the agent for devices advertising right now", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lares-bt-"));
  try {
    liveAgent(dir);
    let seen = "";
    const devices = await scanBluetoothDevices({
      dir,
      now: () => NOW,
      sleep: answerOnSleep(dir, (request) => {
        seen = request.op;
        return {
          op: "scan",
          devices: [{ address: "aa:bb:cc:dd:ee:ff", name: "Galaxy Buds", paired: false, connected: false }],
        };
      }),
    });
    assert.equal(seen, "scan");
    assert.deepEqual(devices.devices, [{
      address: "AA:BB:CC:DD:EE:FF",
      name: "Galaxy Buds",
      paired: false,
      connected: false,
    }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("connect rejects a bad address before talking to the agent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lares-bt-"));
  try {
    await assert.rejects(
      () => connectBluetoothDevice("nope", { dir, now: () => NOW }),
      (err: unknown) => err instanceof VoiceError && err.code === "voice_bluetooth_invalid",
    );
    assert.throws(() => readFileSync(join(dir, "request.json"), "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("connect reports the agent failure when the device stays down", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lares-bt-"));
  try {
    liveAgent(dir);
    await assert.rejects(
      () => connectBluetoothDevice("aa:bb:cc:dd:ee:ff", {
        dir,
        now: () => NOW,
        sleep: answerOnSleep(dir, (request) => {
          assert.equal(request.op, "connect");
          assert.equal(request.address, "AA:BB:CC:DD:EE:FF");
          return { op: "connect", connected: false, error: "bluetooth connect failed" };
        }),
      }),
      (err: unknown) => err instanceof VoiceError && err.code === "voice_bluetooth_connect_failed",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scan output keeps the advertised name and prefers the alias", () => {
  const sample = [
    "[CHG] Controller 00:11:22:33:44:55 Discovering: yes",
    "[\u001b[0;92mNEW\u001b[0m] Device aa:bb:cc:dd:ee:ff Galaxy Buds",
    "[CHG] Device AA:BB:CC:DD:EE:FF RSSI: -40",
    "[CHG] Device 11:22:33:44:55:66 Name: WH-1000XM5",
    "[CHG] Device 11:22:33:44:55:66 Alias: Sony",
  ].join("\n");
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("bt", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
json.dump(mod.parse_scan(sys.stdin.read()), sys.stdout)
`;
  const py = spawnSync("python3", ["-c", script, fileURLToPath(new URL("../../packages/core/voice/host/bluetooth-ready.py", import.meta.url))], {
    input: sample,
    encoding: "utf8",
  });
  assert.equal(py.status, 0, py.stderr);
  assert.deepEqual(JSON.parse(py.stdout), [
    { address: "AA:BB:CC:DD:EE:FF", name: "Galaxy Buds" },
    { address: "11:22:33:44:55:66", name: "Sony" },
  ]);
});

test("a connected headset is marked and address-only advertisers are left out", () => {
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("bt", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
headset = """
	Name: Dolphin520
	Alias: Dolphin520
	Icon: audio-headset
	Paired: yes
	Connected: yes
	UUID: Handsfree                 (0000111e-0000-1000-8000-00805f9b34fb)
"""
phone = """
	Name: LAPTOP-CHD5ALQN
	Icon: computer
	Class: 0x002a010c
	Paired: no
	Connected: no
	UUID: Handsfree                 (0000111e-0000-1000-8000-00805f9b34fb)
"""
twin = """
	Name: Dolphin520
	Alias: Dolphin520
	Paired: no
	Connected: no
"""
scanned = [
    {"address": "C4:3E:2B:B1:18:F6", "name": "Dolphin520"},
    {"address": "46:55:83:84:3E:FC", "name": "46-55-83-84-3E-FC"},
    {"address": "4C:50:F1:C7:E4:D2", "name": "OPPO Reno6 Pro+ 5G"},
]
candidates = mod.scan_candidates(scanned, ["63:47:1F:D4:18:F6"])
infos = {
    "63:47:1F:D4:18:F6": headset,
    "C4:3E:2B:B1:18:F6": twin,
    "4C:50:F1:C7:E4:D2": phone,
}
detailed = [{"address": item["address"], "name": item["name"], "info": infos.get(item["address"], "")} for item in candidates]
json.dump({"candidates": [item["address"] for item in candidates], "devices": mod.voice_devices(detailed)}, sys.stdout)
`;
  const py = spawnSync("python3", ["-c", script, fileURLToPath(new URL("../../packages/core/voice/host/bluetooth-ready.py", import.meta.url))], {
    encoding: "utf8",
  });
  assert.equal(py.status, 0, py.stderr);
  assert.deepEqual(JSON.parse(py.stdout), {
    candidates: ["63:47:1F:D4:18:F6", "C4:3E:2B:B1:18:F6", "4C:50:F1:C7:E4:D2"],
    devices: [{
      address: "63:47:1F:D4:18:F6",
      name: "Dolphin520",
      paired: true,
      connected: true,
    }],
  });
});

test("a live capture is kept so the call link is not dropped between sentences", () => {
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("bt", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
json.dump({
  "live": mod.keep_capture(True, 1000),
  "dead": mod.keep_capture(False, 1000),
  "full": mod.keep_capture(True, mod.CAPTURE_KEEP_BYTES),
}, sys.stdout)
`;
  const py = spawnSync("python3", ["-c", script, fileURLToPath(new URL("../../packages/core/voice/host/bluetooth-ready.py", import.meta.url))], {
    encoding: "utf8",
  });
  assert.equal(py.status, 0, py.stderr);
  assert.deepEqual(JSON.parse(py.stdout), { live: true, dead: false, full: false });
});

test("only a readout cut by the next take leaves a speaker tail to drop", () => {
  const script = `
import importlib.util, json, subprocess, sys
spec = importlib.util.spec_from_file_location("bt", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
done = subprocess.Popen(["true"])
done.wait()
mod.playback_proc = done
mod.interrupt_playback()
finished = mod.consume_settle()
mod.playback_proc = subprocess.Popen(["sleep", "5"])
mod.interrupt_playback()
cut = mod.consume_settle()
json.dump({"finished": finished, "cut": cut, "again": mod.consume_settle()}, sys.stdout)
`;
  const py = spawnSync("python3", ["-c", script, fileURLToPath(new URL("../../packages/core/voice/host/bluetooth-ready.py", import.meta.url))], {
    encoding: "utf8",
  });
  assert.equal(py.status, 0, py.stderr);
  assert.deepEqual(JSON.parse(py.stdout), { finished: false, cut: true, again: false });
});

test("the capture label is the source description the browser lists", () => {
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("bt", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
text = """
Source #1
	Name: bluez_input.63_47_1F_D4_18_F6.0
	Description: Dolphin520
Source #2
	Name: bluez_output.63_47_1F_D4_18_F6.1.monitor
	Description: Monitor of Dolphin520
"""
json.dump(mod.source_labels(text), sys.stdout)
`;
  const py = spawnSync("python3", ["-c", script, fileURLToPath(new URL("../../packages/core/voice/host/bluetooth-ready.py", import.meta.url))], {
    encoding: "utf8",
  });
  assert.equal(py.status, 0, py.stderr);
  assert.deepEqual(JSON.parse(py.stdout), {
    "bluez_input.63_47_1F_D4_18_F6.0": "Dolphin520",
    "bluez_output.63_47_1F_D4_18_F6.1.monitor": "Monitor of Dolphin520",
  });
});

test("playback uses the call speaker and prefers wideband", () => {
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("bt", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
text = """
Sink #1
	Name: bluez_output.AA_BB_CC_DD_EE_FF.1
	api.bluez5.codec = "sbc"
Sink #2
	Name: bluez_output.AA_BB_CC_DD_EE_FF.2
	api.bluez5.codec = "cvsd"
Sink #3
	Name: bluez_output.AA_BB_CC_DD_EE_FF.3
	api.bluez5.codec = "msbc"
"""
json.dump(mod.call_sink_name(text), sys.stdout)
`;
  const py = spawnSync("python3", ["-c", script, fileURLToPath(new URL("../../packages/core/voice/host/bluetooth-ready.py", import.meta.url))], {
    encoding: "utf8",
  });
  assert.equal(py.status, 0, py.stderr);
  assert.equal(JSON.parse(py.stdout), "bluez_output.AA_BB_CC_DD_EE_FF.3");
});

test("only a card that is not already on the microphone profile is switched", () => {
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("bt", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
text = """
Card #1
	Name: bluez_card.AA_BB_CC_DD_EE_FF
	Active Profile: headset-head-unit-msbc
Card #2
	Name: bluez_card.11_22_33_44_55_66
	Active Profile: a2dp-sink
"""
profiles = mod.active_profiles(text)
cards = ["bluez_card.AA_BB_CC_DD_EE_FF", "bluez_card.11_22_33_44_55_66"]
json.dump({"profiles": profiles, "switch": mod.cards_to_switch(cards, profiles)}, sys.stdout)
`;
  const py = spawnSync("python3", ["-c", script, fileURLToPath(new URL("../../packages/core/voice/host/bluetooth-ready.py", import.meta.url))], {
    encoding: "utf8",
  });
  assert.equal(py.status, 0, py.stderr);
  assert.deepEqual(JSON.parse(py.stdout), {
    profiles: {
      "bluez_card.AA_BB_CC_DD_EE_FF": "headset-head-unit-msbc",
      "bluez_card.11_22_33_44_55_66": "a2dp-sink",
    },
    switch: ["bluez_card.11_22_33_44_55_66"],
  });
});

test("a management reply is one datagram, header and body together", () => {
  const script = `
import importlib.util, json, struct, sys
spec = importlib.util.spec_from_file_location("bt", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
body = bytearray(20)
struct.pack_into("<HB", body, 0, mod.OP_READ_INFO, 0)
struct.pack_into("<I", body, 16, 0xE0AC3)
packet = struct.pack("<HHH", mod.EV_COMPLETE, 0, len(body)) + bytes(body)
class OneDatagram:
    def __init__(self):
        self.pending = packet
        self.sent = b""
    def sendall(self, data):
        self.sent += data
    def recv(self, size):
        if not self.pending:
            return b""
        chunk = self.pending[:size]
        self.pending = b""
        return chunk
sock = OneDatagram()
reply = mod._mgmt_transact(sock, mod.OP_READ_INFO)
json.dump({"settings": struct.unpack_from("<I", reply, 16)[0]}, sys.stdout)
`;
  const py = spawnSync("python3", ["-c", script, fileURLToPath(new URL("../../packages/core/voice/host/bluetooth-ready.py", import.meta.url))], {
    encoding: "utf8",
  });
  assert.equal(py.status, 0, py.stderr);
  assert.deepEqual(JSON.parse(py.stdout), { settings: 0xe0ac3 });
});

test("the management socket is the kernel sockaddr, not Python's raw-channel bind", () => {
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("bt", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
addr = mod.SockAddrHCI(mod.AF_BLUETOOTH, mod.HCI_DEV_NONE, mod.HCI_CHANNEL_CONTROL)
class Dead:
    def fileno(self):
        return -1
    def bind(self, *_args):
        raise AssertionError("socket.bind")
error = ""
try:
    mod.bind_management(Dead())
except OSError as exc:
    error = str(exc)
json.dump({
    "family": addr.hci_family,
    "dev": addr.hci_dev,
    "channel": addr.hci_channel,
    "size": mod.ctypes.sizeof(addr),
    "error": error,
}, sys.stdout)
`;
  const py = spawnSync("python3", ["-c", script, fileURLToPath(new URL("../../packages/core/voice/host/bluetooth-ready.py", import.meta.url))], {
    encoding: "utf8",
  });
  assert.equal(py.status, 0, py.stderr);
  const got = JSON.parse(py.stdout);
  assert.equal(got.family, 31);
  assert.equal(got.dev, 0xffff);
  assert.equal(got.channel, 3);
  assert.equal(got.size, 6);
  assert.doesNotMatch(got.error, /wrong format/);
  assert.match(got.error, /Bad file descriptor|Invalid argument/);
});

test("boot pages a trusted headset until the call link is back", () => {
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("bt", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
state = mod.new_restore()
steps = []
def take(headsets, session, armed, now):
    global state
    state, action = mod.restore_step(state, headsets, session, armed, now)
    steps.append({"phase": state["phase"], "action": action, "attempts": state["attempts"]})
down = [("63:47:1F:D4:18:F6", False)]
up = [("63:47:1F:D4:18:F6", True)]
take([], False, False, 0)
take(down, True, False, 10)
take(down, True, False, 11)
take(up, False, False, 20)
take(up, True, False, 30)
take(up, True, True, 31)
gone = mod.new_restore()
for n in range(mod.RESTORE_TRIES):
    gone, action = mod.restore_step(gone, down, True, False, n * 10)
    assert action == "connect", action
gone, action = mod.restore_step(gone, down, True, False, 1000)
json.dump({"steps": steps, "stopped": gone["phase"], "after": action}, sys.stdout)
`;
  const py = spawnSync("python3", ["-c", script, fileURLToPath(new URL("../../packages/core/voice/host/bluetooth-ready.py", import.meta.url))], {
    encoding: "utf8",
  });
  assert.equal(py.status, 0, py.stderr);
  assert.deepEqual(JSON.parse(py.stdout), {
    steps: [
      { phase: "connect", action: null, attempts: 1 },
      { phase: "connect", action: "connect", attempts: 2 },
      { phase: "connect", action: null, attempts: 2 },
      { phase: "wait", action: null, attempts: 2 },
      { phase: "arm", action: "arm", attempts: 2 },
      { phase: "done", action: null, attempts: 2 },
    ],
    stopped: "done",
    after: null,
  });
});

test("wideband speech is ready only when the radio is on and the flag is set", () => {
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("bt", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
powered = mod.POWERED
wide = mod.WIDE
json.dump({
  "both": mod.wideband_ready(powered | wide),
  "radio_only": mod.wideband_ready(powered),
  "missing": mod.wideband_ready(None),
}, sys.stdout)
`;
  const py = spawnSync("python3", ["-c", script, fileURLToPath(new URL("../../packages/core/voice/host/bluetooth-ready.py", import.meta.url))], {
    encoding: "utf8",
  });
  assert.equal(py.status, 0, py.stderr);
  assert.deepEqual(JSON.parse(py.stdout), { both: true, radio_only: false, missing: false });
});

test("speech is not played on the host when no bluetooth agent is running", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lares-bt-"));
  try {
    assert.deepEqual(await playBluetoothAudio(Buffer.from("RIFF"), { dir, now: () => NOW }), {
      played: false,
      skipped: true,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("speech playback asks the host agent to play the wav", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lares-bt-"));
  try {
    liveAgent(dir);
    let file = "";
    const played = await playBluetoothAudio(Buffer.from("RIFF"), {
      dir,
      now: () => NOW,
      id: "speak-1",
      sleep: answerOnSleep(dir, (request) => {
        file = request.file ?? "";
        return { op: "play", ready: true, playing: true, sink: "bluez_output.speaker" };
      }),
    });
    assert.equal(file, "speech-speak-1.wav");
    assert.equal(readFileSync(join(dir, file)).toString(), "RIFF");
    assert.deepEqual(played, { played: true, sink: "bluez_output.speaker" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("speech playback opens a host stream before the wav exists", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lares-bt-"));
  try {
    liveAgent(dir);
    let file = "";
    const chunks = [];
    const opened = await openBluetoothPlayback({
      dir,
      now: () => NOW,
      id: "speak-2",
      sleep: answerOnSleep(dir, (request) => {
        file = request.file ?? "";
        return { op: "play-stream", ready: true, playing: true, sink: "bluez_output.speaker" };
      }),
      writer: {
        async write(chunk) { chunks.push(chunk); },
        async close() {},
        abort() {},
      },
    });
    assert.equal(file, "speech-speak-2.pcm");
    await opened.write(Buffer.from("pcm"));
    assert.equal(Buffer.concat(chunks).toString(), "pcm");
    assert.equal(opened.sink, "bluez_output.speaker");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("speech playback reports the agent failure when the speaker stays silent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lares-bt-"));
  try {
    liveAgent(dir);
    await assert.rejects(
      playBluetoothAudio(Buffer.from("RIFF"), {
        dir,
        now: () => NOW,
        sleep: answerOnSleep(dir, () => ({ op: "play", ready: false, error: "speaker did not receive audio" })),
      }),
      (err: unknown) => err instanceof VoiceError && err.code === "voice_failed",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
