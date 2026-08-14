#!/usr/bin/env bash
# Install a community dsh bundle into a running Dina web profile (server-side).
#
# Native plugins (dsh-better-sidebar → node-pty) compile via node-gyp at profile
# install time. The runtime image ships build-essential + python3 and boot runs
# `npm install` (scripts enabled) as uid 1000, so no root pod / image rebuild is
# needed — declare the bundle, install, reload.
#
# Usage:
#   scripts/install-better-sidebar.sh <机器号> [bundle[@version]]
#   scripts/install-better-sidebar.sh 1                       # dsh-better-sidebar@0.11.0
#   scripts/install-better-sidebar.sh 1 dsh-better-sidebar@0.11.0
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MACHINES_FILE="${DEV_SYNC_MACHINES:-$ROOT/scripts/dev-sync/machines.json}"
MACHINE="${1:?用法: install-better-sidebar.sh <机器号> [bundle[@version]]}"
SPEC="${2:-dsh-better-sidebar@0.11.0}"
BUNDLE="${SPEC%@*}"
VERSION="${SPEC##*@}"
[[ "$VERSION" == "$BUNDLE" ]] && VERSION="latest"

eval "$(
  python3 - "$MACHINES_FILE" "$MACHINE" <<'PY'
import json, shlex, sys
from pathlib import Path
data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
m = next((x for x in (data.get("machines") or []) if str(x.get("id")) == sys.argv[2]), None)
if m is None:
    sys.exit(f"machines.json 中没有 id={sys.argv[2]}")
host = (m.get("ssh") or m.get("lan_ip") or "").strip()
if not host:
    sys.exit("机器未配置 ssh / lan_ip")
print(f"DEST_SSH={shlex.quote(host if '@' in host else f'root@{host}')}")
print(f"KUBE_NS={shlex.quote(m.get('kube_ns') or '')}")
PY
)"

[[ -n "${KUBE_NS:-}" ]] || { echo "机器${MACHINE} 未配置 kube_ns" >&2; exit 1; }
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 "$DEST_SSH")
K="kubectl -n $KUBE_NS"
PROFILE="/data/dina/dsh-home/profiles/dina-web"

echo "[1/3] 声明 bundle $BUNDLE@$VERSION 到 profile"
"${SSH[@]}" "$K exec deploy/dina -c dina -- node -e '
const fs=require(\"fs\");
const p=\"$PROFILE/package.json\";
const pj=JSON.parse(fs.readFileSync(p,\"utf8\"));
pj.dependencies[\"$BUNDLE\"]=\"$VERSION\";
if(!pj.dsh.profile.bundles.includes(\"$BUNDLE\")) pj.dsh.profile.bundles.push(\"$BUNDLE\");
fs.writeFileSync(p,JSON.stringify(pj,null,2)+\"\n\");
console.log(\"bundles:\",pj.dsh.profile.bundles.join(\", \"));
'"

echo "[2/3] 安装（原生模块首次会 node-gyp 编译，约数分钟）"
"${SSH[@]}" "$K exec deploy/dina -c dina -- sh -c 'cd $PROFILE && HOME=/data/home npm install --no-audit --no-fund 2>&1 | tail -5'"

echo "[3/3] 热重载"
"${SSH[@]}" "DEVSRC=\$(find /olares/rootfs/userspace /olares/userdata -maxdepth 8 -type d -path '*/Data/dina/devsrc' 2>/dev/null | head -1); [ -n \"\$DEVSRC\" ] && touch \"\$DEVSRC/.dina-reload\" || $K rollout restart deploy/dina"

echo "完成：$BUNDLE@$VERSION。浏览器硬刷新查看。"
