#!/bin/sh
# Install the host Bluetooth audio pieces Lares talks to. A machine without
# Bluetooth still has to boot Lares, so every step here is allowed to fail.
set -u

VOICE_DIR=${LARES_HOST_VOICE_DIR:-}
PROC=/host-proc/1/ns
SCRIPT=/app/packages/core/voice/host/bluetooth-ready.py

if [ -z "$VOICE_DIR" ] || ! command -v nsenter >/dev/null 2>&1 || [ ! -e "$PROC/mnt" ] || [ ! -f "$SCRIPT" ]; then
  echo "bluetooth host setup skipped: cannot enter the host" >&2
  exit 0
fi

enter() {
  nsenter --mount="$PROC/mnt" --net="$PROC/net" -- "$@"
}

if ! enter /bin/true; then
  echo "bluetooth host setup skipped: host namespace refused" >&2
  exit 0
fi

enter /bin/sh -c '
  missing=""
  command -v python3 >/dev/null 2>&1 || missing="$missing python3"
  command -v bluetoothctl >/dev/null 2>&1 || missing="$missing bluez"
  dpkg -s libspa-0.2-bluetooth >/dev/null 2>&1 || missing="$missing libspa-0.2-bluetooth"
  if [ -z "$missing" ]; then
    exit 0
  fi
  export DEBIAN_FRONTEND=noninteractive
  if apt-get update -qq && apt-get install -y --no-install-recommends $missing; then
    echo "$missing" | grep -q libspa-0.2-bluetooth && touch /run/lares-bluetooth-plugin-new
  else
    echo "bluetooth host packages failed:$missing" >&2
  fi
'

enter /usr/bin/tee /usr/local/sbin/bluetooth-voice-ready >/dev/null < "$SCRIPT"
enter /bin/chmod 755 /usr/local/sbin/bluetooth-voice-ready

enter /usr/bin/tee /etc/systemd/system/bluetooth-wideband-speech.service >/dev/null <<'EOF'
[Unit]
Description=Enable Bluetooth wideband speech for HFP
After=bluetooth.service
PartOf=bluetooth.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/bluetooth-voice-ready wideband
RemainAfterExit=yes

[Install]
WantedBy=bluetooth.service
EOF

enter /usr/bin/tee /etc/systemd/system/bluetooth-voice-ready.service >/dev/null <<EOF
[Unit]
Description=Lares Bluetooth voice agent
After=bluetooth.service bluetooth-wideband-speech.service

[Service]
Type=simple
Environment=LARES_VOICE_BLUETOOTH_DIR=${VOICE_DIR}
ExecStart=/usr/local/sbin/bluetooth-voice-ready serve
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

enter /bin/sh -c '
  mkdir -p "$LARES_HOST_VOICE_DIR"
  chmod 777 "$LARES_HOST_VOICE_DIR"
  systemctl daemon-reload
  systemctl enable bluetooth-wideband-speech.service bluetooth-voice-ready.service
  systemctl restart bluetooth-wideband-speech.service || true
  systemctl restart bluetooth-voice-ready.service || true
  if [ -f /run/lares-bluetooth-plugin-new ] && id olares >/dev/null 2>&1; then
    rm -f /run/lares-bluetooth-plugin-new
    uid=$(id -u olares)
    if [ -d "/run/user/$uid" ]; then
      runuser -u olares -- env XDG_RUNTIME_DIR="/run/user/$uid" systemctl --user restart wireplumber || true
    fi
  fi
'

exit 0
