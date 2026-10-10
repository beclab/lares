#!/usr/bin/env python3
"""Bluetooth headset helper for voice capture.

ensure() makes a paired headset able to capture before a recording starts.
scan lists devices advertising right now. connect pairs and connects one of them.


A connected card is ready once it is on the microphone profile and that input
exists. Switching an already linked card does not wait for a silence probe.
The probe stays on a fresh connect, where the codec often stays quiet for
several seconds.
"""

import ctypes
import glob
import json
import os
import pwd
import re
import signal
import socket
import struct
import subprocess
import sys
import time
import wave
from pathlib import Path

HEADSET_PROFILE = "headset-head-unit-msbc"
PROBE_SECONDS = "1.2"
LIVE_PEAK = 1
POLL_SECONDS = 12
PROFILE_WAIT_SECONDS = 3
SCAN_SECONDS = 8
MAX_DEVICES = 16
ADDRESS = re.compile(r"^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$")
DEVICE_LINE = re.compile(
    r"\[(?:NEW|CHG)\] Device ([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})(?:\s+(.*))?$"
)
ANSI = re.compile(r"\x1b\[[0-9;]*m")
WIDEBAND = "/usr/local/sbin/bluetooth-wideband-speech"
AF_BLUETOOTH = 31
BTPROTO_HCI = 1
HCI_CHANNEL_CONTROL = 3
HCI_DEV_NONE = 0xFFFF
OP_READ_INFO = 0x0004
OP_POWER = 0x0005
OP_CONNECTABLE = 0x0007
OP_WBS = 0x0047
EV_COMPLETE = 0x0001
EV_STATUS = 0x0002
POWERED = 1 << 0
CONNECTABLE = 1 << 1
WIDE = 1 << 17
WIREPLUMBER_SNIPPET = """\
bluez_monitor.properties["with-logind"] = false
bluez_midi_monitor.properties["with-logind"] = false
bluez_monitor.properties["bluez5.hfphsp-backend"] = "native"
bluez_monitor.properties["bluez5.hfphsp-backend-native-modem"] = "any"
"""


def audio_user():
    try:
        return pwd.getpwnam("olares")
    except KeyError:
        return None


def run(cmd, user=None, timeout=20):
    if user is not None:
        cmd = ["runuser", "-u", user.pw_name, "--", "env", f"XDG_RUNTIME_DIR=/run/user/{user.pw_uid}", *cmd]
    return subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)


def pcm_peak(path):
    try:
        with wave.open(path) as wav:
            width = wav.getsampwidth()
            raw = wav.readframes(wav.getnframes())
    except (wave.Error, FileNotFoundError, EOFError):
        return -1
    if width != 2 or len(raw) < 2:
        return -1
    peak = 0
    for offset in range(0, len(raw) - 1, 2):
        sample = int.from_bytes(raw[offset:offset + 2], "little", signed=True)
        magnitude = sample if sample >= 0 else -sample
        if magnitude > peak:
            peak = magnitude
    return peak


def source_labels(text):
    found = {}
    name = ""
    for raw in str(text or "").splitlines():
        line = raw.strip()
        if line.startswith("Name:"):
            name = line.split(":", 1)[1].strip()
        elif name and line.startswith("Description:"):
            found[name] = line.split(":", 1)[1].strip()
            name = ""
    return found


def capture_ready(user, source):
    listed = run(["pactl", "list", "sources"], user=user, timeout=8)
    return {"ready": True, "source": source, "label": source_labels(listed.stdout).get(source, "")}


def bluez_sources(user):
    listed = run(["pactl", "list", "sources", "short"], user=user, timeout=8)
    sources = []
    for line in listed.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[1].startswith("bluez_input."):
            sources.append(parts[1])
    return sources


def probe(user, source):
    path = "/tmp/lares-bt-probe.wav"
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    cmd = [
        "timeout", PROBE_SECONDS, "pw-record",
        "--target", source,
        "--rate=16000", "--channels=1", "--format=s16",
        path,
    ]
    try:
        run(cmd, user=user, timeout=8)
    except subprocess.TimeoutExpired:
        return -1
    return pcm_peak(path)


def live_source(user):
    for source in bluez_sources(user):
        if probe(user, source) >= LIVE_PEAK:
            return source
    return ""


def paired_headsets():
    listed = run(["bluetoothctl", "devices"], timeout=8)
    headsets = []
    for mac in known_addresses(listed.stdout):
        info = run(["bluetoothctl", "info", mac], timeout=8)
        text = info.stdout
        if is_voice_device(text):
            headsets.append((mac, "Connected: yes" in text))
    return headsets


def card_for_node(node, prefix):
    # bluez_input.AA_BB_CC_DD_EE_FF.0 → bluez_card.AA_BB_CC_DD_EE_FF
    body = node.removeprefix(prefix)
    mac = body.rsplit(".", 1)[0]
    return f"bluez_card.{mac}"


def card_for_source(source):
    return card_for_node(source, "bluez_input.")


def bluetooth_cards(user):
    cards = []
    for source in bluez_sources(user):
        card = card_for_source(source)
        if card not in cards:
            cards.append(card)
    listed = run(["pactl", "list", "sinks", "short"], user=user, timeout=8)
    for line in listed.stdout.splitlines():
        parts = line.split()
        if len(parts) < 2 or not parts[1].startswith("bluez_output."):
            continue
        card = card_for_node(parts[1], "bluez_output.")
        if card not in cards:
            cards.append(card)
    return cards


def call_sink_name(text):
    """The call speaker. Wideband mSBC wins over narrowband CVSD."""
    name = ""
    chosen = {"msbc": "", "cvsd": ""}
    for raw in str(text or "").splitlines():
        line = raw.strip()
        if line.startswith("Name: bluez_output."):
            name = line.split("Name:", 1)[1].strip()
        elif name and "api.bluez5.codec" in line:
            codec = line.split("=", 1)[-1].strip().strip('"')
            if codec in chosen and not chosen[codec]:
                chosen[codec] = name
            name = ""
    return chosen["msbc"] or chosen["cvsd"]


def call_sink(user):
    listed = run(["pactl", "list", "sinks"], user=user, timeout=8)
    return call_sink_name(listed.stdout)


playback_proc = None
capture_proc = None
# Set when a sounding readout is cut. The next capture drops the speaker tail, once.
# A readout that played to its end leaves no tail, so the take keeps the first words.
playback_unsettled = False
CAPTURE_FILE = "capture.s16"
# WebRTC gain inside PipeWire. A voice that is not against the headset stays
# loud enough to transcribe. Pulse names are translated to webrtc.* by the module.
ECHO_SOURCE = "lares.echo-cancel-source"
ECHO_SINK = "lares.echo-cancel-sink"
ECHO_ARGS = "digital_gain_control=1 noise_suppression=1 high_pass_filter=1"


def consume_settle():
    global playback_unsettled
    due = playback_unsettled
    playback_unsettled = False
    return due


# A few minutes of 16 kHz mono. Past this the next take opens a new link.
CAPTURE_KEEP_BYTES = 8 * 1024 * 1024


def stop_playback():
    """Drop a readout that is still running so the headset can return to the microphone."""
    global playback_proc
    proc = playback_proc
    playback_proc = None
    if proc is None or proc.poll() is not None:
        return False
    proc.terminate()
    try:
        proc.wait(timeout=2)
    except subprocess.TimeoutExpired:
        proc.kill()
    return True


def interrupt_playback():
    """The microphone takes the link. A readout it cuts still rings in the earcup."""
    global playback_unsettled
    if stop_playback():
        playback_unsettled = True


def stop_playback_request():
    interrupt_playback()
    return {"op": "playback-stop", "ready": True, "stopped": True}


def stop_proc(proc):
    if proc is None or proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        proc.wait(timeout=0.3)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
        proc.wait(timeout=2)


def stop_capture():
    """Drop the call link. Doing this at the end of a sentence stalls the machine."""
    global capture_proc
    proc = capture_proc
    capture_proc = None
    stop_proc(proc)


def keep_capture(alive, size):
    return bool(alive) and 0 <= size < CAPTURE_KEEP_BYTES


def echo_cancel_text(user):
    return run(["pactl", "list", "modules"], user=user, timeout=8).stdout


def echo_cancel_ready(user, source, sink):
    text = echo_cancel_text(user)
    return (
        f"source_master={source}" in text
        and f"sink_master={sink}" in text
        and f"source_name={ECHO_SOURCE}" in text
        and ECHO_ARGS in text
    )


def unload_echo_cancel(user):
    listed = run(["pactl", "list", "modules", "short"], user=user, timeout=8)
    for line in listed.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2 and parts[1] == "module-echo-cancel":
            run(["pactl", "unload-module", parts[0]], user=user, timeout=8)


def ensure_echo_cancel(user, source):
    """Capture through echo-cancel so a normal speaking distance is still intelligible.

    The raw headset is quiet once you step back, and that is what the recognizer
    mishears. The module's digital gain is the same control the browser mic used.
    A missing module leaves the raw headset in place.
    """
    sink = call_sink(user)
    if not source or not sink:
        return source
    if echo_cancel_ready(user, source, sink):
        return ECHO_SOURCE
    unload_echo_cancel(user)
    loaded = run([
        "pactl", "load-module", "module-echo-cancel",
        f"source_master={source}",
        f"sink_master={sink}",
        f"source_name={ECHO_SOURCE}",
        f"sink_name={ECHO_SINK}",
        "rate=16000",
        "channels=1",
        "aec_method=webrtc",
        f"aec_args={ECHO_ARGS}",
    ], user=user, timeout=8)
    if loaded.returncode != 0:
        return source
    names = run(["pactl", "list", "sources", "short"], user=user, timeout=8).stdout
    if ECHO_SOURCE in names:
        return ECHO_SOURCE
    return source


def speaker_sink(user, sink):
    names = run(["pactl", "list", "sinks", "short"], user=user, timeout=8).stdout
    if ECHO_SINK in names:
        return ECHO_SINK
    return sink


def begin_capture(directory):
    """Record the headset on this machine. The browser only watches the phase.

    pw-cat writes the device latency as digital silence when the target is
    stdout. A file target does not, and it still grows while the take is open.
    The process stays up across takes: closing it drops the Bluetooth call
    link, and that stalls the machine.
    """
    global capture_proc
    path = Path(directory) / CAPTURE_FILE
    if capture_proc is not None and capture_proc.poll() is None and path.is_file():
        size = path.stat().st_size
        if keep_capture(True, size):
            interrupt_playback()
            return {
                "op": "capture-start",
                "ready": True,
                "source": "",
                "file": CAPTURE_FILE,
                "offset": size,
                "settle": consume_settle(),
            }
    stop_capture()
    ready = ensure()
    ready["op"] = "capture-start"
    if not ready.get("ready") or ready.get("skipped") or not ready.get("source"):
        return ready
    user = audio_user()
    if user is None or not os.path.isdir(f"/run/user/{user.pw_uid}"):
        return {"op": "capture-start", "ready": True, "skipped": True, "reason": "no desktop audio session"}
    path = Path(directory) / CAPTURE_FILE
    path.unlink(missing_ok=True)
    source = ensure_echo_cancel(user, ready["source"])
    proc = subprocess.Popen(
        [
            "runuser", "-u", user.pw_name, "--", "env", f"XDG_RUNTIME_DIR=/run/user/{user.pw_uid}",
            "pw-cat", "--record", "--target", source,
            "--rate", "16000", "--channels", "1", "--format", "s16",
            "--latency", "40ms", str(path),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    capture_proc = proc
    time.sleep(0.2)
    if proc.poll() is not None:
        stop_capture()
        return {"op": "capture-start", "ready": False, "error": "microphone did not start"}
    if path.exists():
        os.chmod(path, 0o644)
    return {
        "op": "capture-start",
        "ready": True,
        "source": ready["source"],
        "label": ready.get("label", ""),
        "file": CAPTURE_FILE,
        "offset": 0,
        "settle": consume_settle(),
    }


def end_capture():
    return {"op": "capture-stop", "ready": True}


def reset_capture():
    """A take heard only digital zeros. The kernel can lose the SCO handle
    ("SCO packet for unknown connection handle") while the card stays on the
    call profile, and reopening the recorder keeps that dead link. Leaving the
    profile rebuilds it.
    """
    stop_capture()
    user = audio_user()
    if user is not None and os.path.isdir(f"/run/user/{user.pw_uid}"):
        for card in bluetooth_cards(user):
            run(["pactl", "set-card-profile", card, "off"], user=user, timeout=8)
            run(["pactl", "set-card-profile", card, HEADSET_PROFILE], user=user, timeout=8)
    return {"op": "capture-reset", "ready": True}


def spawn(cmd, user):
    full = ["runuser", "-u", user.pw_name, "--", "env", f"XDG_RUNTIME_DIR=/run/user/{user.pw_uid}", *cmd]
    return subprocess.Popen(full, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def play_file(directory, name):
    """Play speech on the machine the headset is plugged into.

    The browser's player reports success without opening a playback stream, so
    a readout has to be played here. Ready means the speaker monitor heard it.
    """
    global playback_proc, playback_unsettled
    safe = Path(str(name or "")).name
    path = Path(directory) / safe
    if safe != str(name or "") or not safe.endswith(".wav") or not path.is_file():
        return {"op": "play", "ready": False, "error": "playback file is missing"}
    user = audio_user()
    if user is None or not os.path.isdir(f"/run/user/{user.pw_uid}"):
        return {"op": "play", "ready": True, "skipped": True}
    os.chmod(path, 0o644)
    prepared = prepare_playback()
    if prepared.get("skipped"):
        return {"op": "play", "ready": True, "skipped": True}
    if not prepared.get("ready"):
        return {"op": "play", "ready": False, "error": prepared.get("error") or "bluetooth speaker did not become ready"}
    sink = speaker_sink(user, prepared["sink"])
    run(["pactl", "set-sink-volume", sink, "80%"], user=user, timeout=8)
    stop_playback()
    playback_unsettled = False
    proc = spawn(["pw-play", "--target", sink, str(path)], user)
    playback_proc = proc
    for stale in Path(directory).glob("speech-*.wav"):
        if stale.name != safe:
            stale.unlink(missing_ok=True)
    time.sleep(0.2)
    if proc.poll() is not None:
        err = proc.stderr.read().decode(errors="replace")[:200].strip() if proc.stderr else ""
        return {"op": "play", "ready": False, "playing": False, "error": err or "playback ended before it started"}
    # The headset monitor stays digital silence while the earcup plays.
    heard = probe(user, f"{sink}.monitor") >= LIVE_PEAK or (
        sink in (call_sink(user), ECHO_SINK) and proc.poll() is None
    )
    if heard:
        return {"op": "play", "ready": True, "playing": True, "sink": sink}
    stop_playback()
    return {"op": "play", "ready": False, "playing": False, "error": "speaker did not receive audio"}


def open_stream(directory, name, rate=24000, channels=1):
    """Start the speaker and return once it is waiting for PCM.

    The caller writes 24 kHz mono s16le into the fifo as each sentence arrives.
    pw-cat reads raw PCM from stdin; giving it the fifo path makes sndfile
    try to parse the stream as a container and exit before any sample plays.
    """
    global playback_proc, playback_unsettled
    safe = Path(str(name or "")).name
    try:
        rate = int(rate)
        channels = int(channels)
    except (TypeError, ValueError):
        return {"op": "play-stream", "ready": False, "error": "invalid playback format"}
    if safe != str(name or "") or not safe.endswith(".pcm") or rate < 8000 or rate > 96000 or channels != 1:
        return {"op": "play-stream", "ready": False, "error": "invalid playback format"}
    user = audio_user()
    if user is None or not os.path.isdir(f"/run/user/{user.pw_uid}"):
        return {"op": "play-stream", "ready": True, "skipped": True}
    prepared = prepare_playback()
    if prepared.get("skipped"):
        return {"op": "play-stream", "ready": True, "skipped": True}
    if not prepared.get("ready"):
        return {"op": "play-stream", "ready": False, "error": prepared.get("error") or "bluetooth speaker did not become ready"}
    sink = speaker_sink(user, prepared["sink"])
    run(["pactl", "set-sink-volume", sink, "80%"], user=user, timeout=8)
    stop_playback()
    playback_unsettled = False
    path = Path(directory) / safe
    for stale in Path(directory).glob("speech-*.pcm"):
        if stale.name != safe:
            stale.unlink(missing_ok=True)
    if path.exists():
        path.unlink()
    os.mkfifo(path, 0o666)
    os.chmod(path, 0o666)
    proc = spawn([
        "sh", "-c",
        'exec pw-cat --playback --target "$1" --rate "$2" --channels 1 --format s16 --latency 40ms - < "$3"',
        "pw-cat",
        sink,
        str(rate),
        str(path),
    ], user)
    playback_proc = proc
    time.sleep(0.2)
    if proc.poll() is not None:
        err = proc.stderr.read().decode(errors="replace")[:200].strip() if proc.stderr else ""
        return {"op": "play-stream", "ready": False, "playing": False, "error": err or "playback ended before it started"}
    return {"op": "play-stream", "ready": True, "playing": True, "sink": sink, "file": safe}


def prepare_playback():
    """Play on the call profile.

    The card stays on the microphone profile, so the next recording does not
    reopen the headset link. The call speaker is mSBC, 16 kHz mono.
    """
    user = audio_user()
    if user is None or not os.path.isdir(f"/run/user/{user.pw_uid}"):
        return {"op": "playback", "ready": True, "skipped": True}
    cards = bluetooth_cards(user)
    if not cards:
        connect_headset()
        cards = bluetooth_cards(user)
    listed = run(["pactl", "list", "cards"], user=user, timeout=8)
    for card in cards_to_switch(cards, active_profiles(listed.stdout)):
        run(["pactl", "set-card-profile", card, HEADSET_PROFILE], user=user, timeout=8)
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        sink = call_sink(user)
        if sink:
            sources = bluez_sources(user)
            if sources:
                ensure_echo_cancel(user, sources[0])
            run(["pactl", "set-default-sink", sink], user=user, timeout=8)
            return {"op": "playback", "ready": True, "sink": speaker_sink(user, sink)}
        time.sleep(0.4)
    return {"op": "playback", "ready": False, "error": "bluetooth speaker did not become ready"}


def ensure_wireplumber(user):
    path = Path(user.pw_dir) / ".config/wireplumber/bluetooth.lua.d/80-bluetooth-without-seat.lua"
    current = path.read_text() if path.exists() else ""
    if "hfphsp-backend-native-modem" in current and "enable-msbc" not in current and "with-logind" in current:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(WIREPLUMBER_SNIPPET)
    os.chown(path, user.pw_uid, user.pw_gid)
    run(["systemctl", "--user", "restart", "wireplumber"], user=user, timeout=30)
    time.sleep(2)
    return True


def wideband_ready(settings):
    return bool(settings is not None and settings & POWERED and settings & WIDE)


class SockAddrHCI(ctypes.Structure):
    _fields_ = [
        ("hci_family", ctypes.c_ushort),
        ("hci_dev", ctypes.c_ushort),
        ("hci_channel", ctypes.c_ushort),
    ]


def bind_management(sock):
    """Open the kernel management channel.

    Python's socket.bind on an HCI socket only accepts a device index and
    forces the raw channel, so the management socket never comes up and the
    adapter looks missing.
    """
    addr = SockAddrHCI(AF_BLUETOOTH, HCI_DEV_NONE, HCI_CHANNEL_CONTROL)
    err = ctypes.CDLL(None, use_errno=True).bind(
        sock.fileno(), ctypes.byref(addr), ctypes.sizeof(addr),
    )
    if err != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))


def bluetooth_audio_plugin():
    return bool(glob.glob("/usr/lib/*/spa-0.2/bluez5/libspa-bluez5.so"))


def _mgmt_recv(sock):
    # One recv is one datagram. A short read discards the rest of the message.
    data = sock.recv(4096)
    if len(data) < 6:
        raise OSError("bluetooth management socket closed")
    event, _index, length = struct.unpack_from("<HHH", data)
    body = data[6:6 + length]
    if len(body) < length:
        raise OSError("truncated bluetooth management packet")
    return event, body


def _mgmt_transact(sock, opcode, payload=b""):
    sock.sendall(struct.pack("<HHH", opcode, 0, len(payload)) + payload)
    while True:
        event, body = _mgmt_recv(sock)
        if len(body) < 3:
            continue
        op, status = struct.unpack_from("<HB", body)
        if op != opcode or event not in (EV_COMPLETE, EV_STATUS):
            continue
        if status != 0:
            raise OSError(f"management op {opcode:#06x} failed with status {status:#04x}")
        return body


def controller_settings():
    try:
        sock = socket.socket(AF_BLUETOOTH, socket.SOCK_RAW, BTPROTO_HCI)
    except OSError:
        return None
    sock.settimeout(8)
    try:
        bind_management(sock)
        body = _mgmt_transact(sock, OP_READ_INFO)
    except (OSError, TimeoutError):
        return None
    finally:
        sock.close()
    if len(body) < 20:
        return None
    return struct.unpack_from("<I", body, 16)[0]


def enable_wideband():
    sock = socket.socket(AF_BLUETOOTH, socket.SOCK_RAW, BTPROTO_HCI)
    sock.settimeout(8)
    try:
        bind_management(sock)
        _mgmt_transact(sock, OP_POWER, bytes([0]))
        _mgmt_transact(sock, OP_WBS, bytes([1]))
        _mgmt_transact(sock, OP_POWER, bytes([1]))
        body = _mgmt_transact(sock, OP_CONNECTABLE, bytes([1]))
    finally:
        sock.close()
    if len(body) < 7:
        return None
    return struct.unpack_from("<I", body, 3)[0]


def ensure_wideband():
    """Turn wideband speech on. BlueZ 5.72 forgets it, and the kernel only accepts it while the radio is off."""
    settings = controller_settings()
    if settings is None:
        if os.path.isfile(WIDEBAND):
            run([WIDEBAND], timeout=20)
            return "" if controller_settings() is not None else "bluetooth adapter is not available"
        return "bluetooth adapter is not available"
    if wideband_ready(settings):
        return ""
    try:
        enabled = enable_wideband()
    except (OSError, TimeoutError):
        enabled = None
    if wideband_ready(enabled) or wideband_ready(controller_settings()):
        return ""
    if os.path.isfile(WIDEBAND):
        run([WIDEBAND], timeout=20)
        if wideband_ready(controller_settings()):
            return ""
    return "bluetooth wideband speech is off"


def prepare_audio():
    if not bluetooth_audio_plugin():
        return "bluetooth audio is not available"
    err = ensure_wideband()
    if err:
        return err
    user = audio_user()
    if user is not None and os.path.isdir(f"/run/user/{user.pw_uid}"):
        ensure_wireplumber(user)
    return ""


def connect_headset():
    headsets = paired_headsets()
    if not headsets:
        return ""
    connected = [mac for mac, is_up in headsets if is_up]
    mac = connected[0] if connected else headsets[0][0]
    if mac not in connected:
        run(["bluetoothctl", "connect", mac], timeout=20)
        time.sleep(1)
    return mac


def active_profiles(text):
    found = {}
    name = ""
    for raw in str(text or "").splitlines():
        line = raw.strip()
        if line.startswith("Name:"):
            name = line.split(":", 1)[1].strip()
        elif name and line.startswith("Active Profile:"):
            found[name] = line.split(":", 1)[1].strip()
            name = ""
    return found


def cards_to_switch(cards, profiles):
    return [card for card in cards if profiles.get(card) != HEADSET_PROFILE]


def arm_headset(user):
    """Return the headset input, switching off the speaker profile only when needed.

    The profile change is the whole wait. A silence probe is for a cold connect.
    """
    cards = bluetooth_cards(user)
    if not cards:
        return ""
    listed = run(["pactl", "list", "cards"], user=user, timeout=8)
    for card in cards_to_switch(cards, active_profiles(listed.stdout)):
        run(["pactl", "set-card-profile", card, HEADSET_PROFILE], user=user, timeout=8)
    deadline = time.monotonic() + PROFILE_WAIT_SECONDS
    while True:
        sources = bluez_sources(user)
        if sources:
            source = sources[0]
            run(["pactl", "set-default-source", source], user=user, timeout=8)
            return source
        if time.monotonic() >= deadline:
            return ""
        time.sleep(0.2)


def select_profile(user, source):
    if not source:
        return
    run(["pactl", "set-card-profile", card_for_source(source), HEADSET_PROFILE], user=user, timeout=8)
    run(["pactl", "set-default-source", source], user=user, timeout=8)


def select_headset(user):
    for card in bluetooth_cards(user):
        run(["pactl", "set-card-profile", card, HEADSET_PROFILE], user=user, timeout=8)


def wait_until_live(user, seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        source = live_source(user)
        if source:
            select_profile(user, source)
            return source
        time.sleep(1)
    return ""


def ensure():
    interrupt_playback()
    user = audio_user()
    if user is None or not os.path.isdir(f"/run/user/{user.pw_uid}"):
        return {"ready": True, "skipped": True, "reason": "no desktop audio session"}
    source = arm_headset(user)
    if source:
        return capture_ready(user, source)
    ensure_wideband()
    ensure_wireplumber(user)
    connect_headset()
    select_headset(user)
    source = wait_until_live(user, POLL_SECONDS)
    if source:
        return capture_ready(user, source)
    # The first codec answer is often dropped. Reconnecting gives the retry a clean link.
    headsets = paired_headsets()
    if headsets:
        mac = headsets[0][0]
        run(["bluetoothctl", "disconnect", mac], timeout=15)
        time.sleep(1)
        run(["bluetoothctl", "connect", mac], timeout=20)
        time.sleep(1)
        select_headset(user)
        source = wait_until_live(user, POLL_SECONDS)
        if source:
            return capture_ready(user, source)
    if not headsets and not bluez_sources(user):
        return {"ready": True, "skipped": True, "reason": "no bluetooth headset"}
    return {"ready": False, "error": "bluetooth headset is not capturing"}


def valid_address(address):
    return bool(ADDRESS.fullmatch(str(address or "").strip().upper()))


def parse_scan(text):
    found = {}
    order = []
    for raw in str(text or "").splitlines():
        match = DEVICE_LINE.search(ANSI.sub("", raw).strip())
        if not match:
            continue
        mac = match.group(1).upper()
        rest = (match.group(2) or "").strip()
        if mac not in found:
            order.append(mac)
            found[mac] = {"name": "", "alias": ""}
        entry = found[mac]
        if rest.startswith("Alias:"):
            entry["alias"] = rest.split(":", 1)[1].strip()
        elif rest.startswith("Name:"):
            entry["name"] = rest.split(":", 1)[1].strip()
        elif rest and ":" not in rest.split(" ", 1)[0] and not entry["name"]:
            entry["name"] = rest
    return [{"address": mac, "name": found[mac]["alias"] or found[mac]["name"]} for mac in order]


def device_name(text):
    alias = ""
    name = ""
    for line in str(text or "").splitlines():
        stripped = line.strip()
        if stripped.startswith("Alias:"):
            alias = stripped.split(":", 1)[1].strip()
        elif stripped.startswith("Name:"):
            name = stripped.split(":", 1)[1].strip()
    return alias or name


def known_addresses(text):
    found = []
    for line in ANSI.sub("", str(text or "")).splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0] == "Device" and valid_address(parts[1]):
            mac = parts[1].upper()
            if mac not in found:
                found.append(mac)
    return found


def address_named(address, name):
    shown = re.sub(r"[^0-9A-F]", "", str(name or "").upper())
    return bool(shown) and shown == re.sub(r"[^0-9A-F]", "", str(address or "").upper())


def is_voice_device(text):
    """A headset. Phones and computers also advertise the headset UUIDs."""
    plain = ANSI.sub("", str(text or ""))
    icon = ""
    for line in plain.splitlines():
        stripped = line.strip()
        if stripped.startswith("Icon:"):
            icon = stripped.split(":", 1)[1].strip()
            break
    if icon in ("computer", "phone", "video-display"):
        return False
    if icon in ("audio-headset", "audio-headphones"):
        return True
    match = re.search(r"Class:\s+0x([0-9A-Fa-f]+)", plain)
    if not match:
        return False
    value = int(match.group(1), 16)
    major = (value >> 8) & 0x1F
    minor = (value >> 2) & 0x3F
    return major == 0x04 and minor in {0x01, 0x02, 0x04, 0x06, 0x07}


def scan_candidates(scanned, known):
    """Paired devices first, then named advertisers. An address-shaped name is not a device."""
    names = {}
    order = []
    for mac in known or []:
        mac = str(mac or "").upper()
        if not valid_address(mac) or mac in names:
            continue
        names[mac] = ""
        order.append(mac)
    for item in scanned or []:
        mac = str(item.get("address") or "").upper()
        if not valid_address(mac) or mac in names:
            continue
        name = item.get("name") or ""
        if address_named(mac, name):
            continue
        names[mac] = name
        order.append(mac)
    return [{"address": mac, "name": names[mac]} for mac in order]


def voice_devices(candidates):
    """Voice devices only. A connected headset stays even if it did not advertise,
    and a second address with the same name does not show up as disconnected.
    """
    found = []
    for item in candidates or []:
        info = ANSI.sub("", str(item.get("info") or ""))
        if not is_voice_device(info):
            continue
        mac = str(item.get("address") or "").upper()
        if not valid_address(mac):
            continue
        name = device_name(info) or item.get("name") or mac
        if address_named(mac, name):
            continue
        found.append({
            "address": mac,
            "name": name,
            "paired": "Paired: yes" in info,
            "connected": "Connected: yes" in info,
        })
    connected_names = {item["name"] for item in found if item["connected"]}
    kept = [
        item for item in found
        if item["connected"] or item["name"] not in connected_names
    ]
    kept.sort(key=lambda item: not item["connected"])
    return kept[:MAX_DEVICES]


def source_for_address(user, mac):
    token = mac.replace(":", "_")
    for source in bluez_sources(user):
        if token in source:
            return source
    return ""


def wait_for_source(user, mac, seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        source = source_for_address(user, mac)
        if source:
            select_profile(user, source)
            return source
        time.sleep(1)
    return ""


def activate_capture(mac):
    user = audio_user()
    if user is None or not os.path.isdir(f"/run/user/{user.pw_uid}"):
        return "no desktop audio session"
    if wait_for_source(user, mac, POLL_SECONDS):
        return ""
    run(["bluetoothctl", "disconnect", mac], timeout=15)
    time.sleep(1)
    run(["bluetoothctl", "connect", mac], timeout=20)
    time.sleep(1)
    if wait_for_source(user, mac, POLL_SECONDS):
        return ""
    return "bluetooth headset is not capturing"


def scan_nearby():
    err = prepare_audio()
    if err:
        return {"op": "scan", "devices": [], "error": err, "code": "voice_bluetooth_unavailable"}
    try:
        run(["bluetoothctl", "power", "on"], timeout=8)
    except subprocess.TimeoutExpired:
        pass
    except FileNotFoundError:
        return {"op": "scan", "devices": [], "error": "bluetoothctl is not installed"}
    try:
        listed = run(
            ["bluetoothctl", "--timeout", str(SCAN_SECONDS), "scan", "on"],
            timeout=SCAN_SECONDS + 8,
        )
        text = f"{listed.stdout or ''}\n{listed.stderr or ''}"
    except subprocess.TimeoutExpired as err:
        text = f"{err.stdout or ''}\n{err.stderr or ''}"
    except FileNotFoundError:
        return {"op": "scan", "devices": [], "error": "bluetoothctl is not installed"}
    known = known_addresses(run(["bluetoothctl", "devices"], timeout=8).stdout)
    candidates = scan_candidates(parse_scan(text), known)
    detailed = []
    for item in candidates:
        info = run(["bluetoothctl", "info", item["address"]], timeout=8)
        detailed.append({**item, "info": info.stdout})
    return {"op": "scan", "devices": voice_devices(detailed)}


def connect_address(address):
    mac = str(address or "").strip().upper()
    if not valid_address(mac):
        return {"op": "connect", "connected": False, "error": "invalid bluetooth address"}
    err = prepare_audio()
    if err:
        return {"op": "connect", "address": mac, "connected": False, "error": err, "code": "voice_bluetooth_unavailable"}
    try:
        run(["bluetoothctl", "power", "on"], timeout=8)
    except subprocess.TimeoutExpired:
        pass
    except FileNotFoundError:
        return {"op": "connect", "address": mac, "connected": False, "error": "bluetoothctl is not installed"}
    info = run(["bluetoothctl", "info", mac], timeout=8)
    if "Paired: yes" not in info.stdout:
        run(
            ["bluetoothctl", "--agent", "NoInputNoOutput", "--timeout", "30", "pair", mac],
            timeout=35,
        )
    run(["bluetoothctl", "trust", mac], timeout=10)
    run(["bluetoothctl", "--timeout", "20", "connect", mac], timeout=25)
    info = run(["bluetoothctl", "info", mac], timeout=8)
    connected = "Connected: yes" in info.stdout
    result = {
        "op": "connect",
        "address": mac,
        "name": device_name(info.stdout) or mac,
        "connected": connected,
    }
    if not connected:
        result["error"] = "bluetooth connect failed"
        return result
    err = activate_capture(mac)
    if err:
        result["connected"] = False
        result["error"] = err
    return result


def dispatch(payload, directory):
    op = payload.get("op") or "ensure"
    if op == "scan":
        return scan_nearby()
    if op == "connect":
        return connect_address(payload.get("address"))
    if op == "ensure":
        outcome = ensure()
        outcome["op"] = "ensure"
        return outcome
    if op == "playback":
        return prepare_playback()
    if op == "play":
        return play_file(directory, payload.get("file"))
    if op == "play-stream":
        return open_stream(directory, payload.get("file"), payload.get("rate"), payload.get("channels"))
    if op == "playback-stop":
        return stop_playback_request()
    if op == "capture-start":
        return begin_capture(directory)
    if op == "capture-stop":
        return end_capture()
    if op == "capture-reset":
        return reset_capture()
    return {"op": op, "error": "unknown bluetooth operation"}


def serve(directory):
    directory.mkdir(parents=True, exist_ok=True)
    os.chmod(directory, 0o777)
    agent = directory / "agent.json"
    request = directory / "request.json"
    result = directory / "result.json"
    while True:
        agent.write_text(json.dumps({"pid": os.getpid(), "at": time.time()}))
        if request.exists():
            try:
                payload = json.loads(request.read_text() or "{}")
            except json.JSONDecodeError:
                payload = {}
            request.unlink(missing_ok=True)
            try:
                outcome = dispatch(payload, directory)
            except Exception as err:
                outcome = {
                    "op": payload.get("op") or "ensure",
                    "ready": False,
                    "connected": False,
                    "error": str(err),
                }
            outcome["id"] = payload.get("id", "")
            result.write_text(json.dumps(outcome))
            os.chmod(result, 0o644)
        time.sleep(0.2)


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "ensure"
    if command == "serve":
        raw = os.environ.get("LARES_VOICE_BLUETOOTH_DIR", "")
        if not raw:
            raise SystemExit("LARES_VOICE_BLUETOOTH_DIR is required")
        serve(Path(raw))
        return
    if command == "wideband":
        err = ensure_wideband()
        if err:
            raise SystemExit(err)
        return
    if command != "ensure":
        raise SystemExit(f"unknown command {command}")
    print(json.dumps(ensure()))


if __name__ == "__main__":
    main()
