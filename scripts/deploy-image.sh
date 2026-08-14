#!/usr/bin/env bash
# 把本机构建的镜像 save 后经 SSH 传到目标机，并 import 进 containerd（k8s.io）。
# 测试期默认走这条路径，禁止默认 docker push / 走 registry。
#
# Usage:
#   scripts/deploy-image.sh <机器号>              # 用 Chart.yaml version 对应镜像
#   scripts/deploy-image.sh 1 --image repo:tag
#   scripts/deploy-image.sh 1 --build             # 先 build-image.sh --load 再传
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/project.sh
source "$ROOT/scripts/lib/project.sh"
MACHINES_FILE="${DEV_SYNC_MACHINES:-$ROOT/scripts/dev-sync/machines.json}"

VERSION="$(awk '/^version:/{print $2; exit}' "$CHART_DIR/Chart.yaml")"
IMAGE="${IMAGE:-${IMAGE_REPO}:${VERSION}}"
MACHINE=""
DO_BUILD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)
      shift
      IMAGE="$1"
      ;;
    --build) DO_BUILD=1 ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    [0-9]*)
      MACHINE="$1"
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

[[ -n "$MACHINE" ]] || { echo "Usage: scripts/deploy-image.sh <机器号> [--build] [--image repo:tag]" >&2; exit 2; }
[[ -f "$MACHINES_FILE" ]] || { echo "missing $MACHINES_FILE" >&2; exit 1; }

eval "$(
  python3 - "$MACHINES_FILE" "$MACHINE" <<'PY'
import json, shlex, sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
want = sys.argv[2]
m = next((x for x in (data.get("machines") or []) if str(x.get("id")) == want), None)
if m is None:
    sys.exit(f"machines.json 中没有 id={want}")
login = m.get("login") or {}
host = (m.get("ssh") or m.get("lan_ip") or "").strip()
if not host:
    sys.exit("机器未配置 ssh / lan_ip")
root_ssh = (login.get("root_ssh") or "").strip()
# Prefer root@ for ctr import; fall back to ssh field as-is.
if "@" in host:
    dest = host
elif root_ssh.startswith("key "):
    key = root_ssh[4:].strip()
    print(f"SSH_IDENTITY={shlex.quote(key)}")
    dest = f"root@{host}"
else:
    dest = f"root@{host}"
print(f"DEST_SSH={shlex.quote(dest)}")
print(f"MACHINE_NAME={shlex.quote(str(m.get('name') or f'机器{want}'))}")
PY
)"

SSH_OPTS=(
  -o BatchMode=yes
  -o ConnectTimeout=20
  -o ServerAliveInterval=20
  -o ServerAliveCountMax=3
)
if [[ -n "${SSH_IDENTITY-}" ]]; then
  SSH_OPTS+=(-i "$SSH_IDENTITY")
fi

if [[ "$DO_BUILD" -eq 1 ]]; then
  echo "Building $IMAGE (local load, no push)…"
  bash "$ROOT/scripts/build-image.sh" --image "$IMAGE"
fi

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "本地没有镜像 $IMAGE；先 scripts/build-image.sh 或加 --build" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
TAR="$TMP/image.tar"
REMOTE_TAR="/tmp/${APP_NAME}-image-$$.tar"

echo "save $IMAGE → $TAR"
docker save -o "$TAR" "$IMAGE"
SIZE="$(du -h "$TAR" | awk '{print $1}')"
echo "scp ($SIZE) → ${DEST_SSH}:${REMOTE_TAR}"
scp "${SSH_OPTS[@]}" "$TAR" "${DEST_SSH}:${REMOTE_TAR}"

echo "ctr import on ${MACHINE_NAME} (${DEST_SSH})"
# shellcheck disable=SC2029
ssh "${SSH_OPTS[@]}" "${DEST_SSH}" \
  "set -euo pipefail; ctr -n k8s.io images import $(printf '%q' "$REMOTE_TAR"); rm -f $(printf '%q' "$REMOTE_TAR"); ctr -n k8s.io images ls | grep -F $(printf '%q' "${IMAGE#docker.io/}") || ctr -n k8s.io images ls | grep -F $(printf '%q' "$IMAGE") || true"

echo "Done: $IMAGE on ${MACHINE_NAME}"
echo "若 chart 已指向该 tag：kubectl -n <ns> rollout restart deploy/${APP_NAME}"
echo "若首次 / 换底座：装 upload 源的 dev chart（勿默认 push / 上公共市场）"
