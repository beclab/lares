#!/usr/bin/env bash
# ==============================================================================
# 测试期一键热更新（Olares 集群内，免重建镜像 / 免走市场）
# 应用名取自仓库根 project.json（APP_NAME）。
#
# 前置：chart 安装时 values.dev.hotReload=true（生产包必须 false）
# 机器清单：同目录 machines.json（可从 machines.example.json 复制）
#
# 用法：
#   scripts/dev-sync/sync.sh list
#   scripts/dev-sync/sync.sh info <n>
#   scripts/dev-sync/sync.sh sync <n> [all|packages] [选项]
#   scripts/dev-sync/sync.sh discover <n>
#   scripts/dev-sync/sync.sh help
#
# 简写（机器号作首参）：
#   scripts/dev-sync/sync.sh 1                  # = sync 1 all
#   scripts/dev-sync/sync.sh 2 packages
#   scripts/dev-sync/sync.sh 3 all --watch
#
# 同步范围：
#   all|packages  同步应用根（packages/ + dist/）到热更新目录
#
# 选项：
#   --watch     持续监听源码变更后自动同步
#   --restart   同步后强制重启 pod
#   --no-build  跳过本地构建（默认会先 npm run build 再同步产物）
#
# ssh 可只写 IP（自动补 root@）；dest_dir 可留空，按 kube_ns 自动发现。
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=scripts/lib/project.sh
source "${REPO_ROOT}/scripts/lib/project.sh"
MACHINES_FILE="${DEV_SYNC_MACHINES:-${SCRIPT_DIR}/machines.json}"

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

usage() {
  sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'
}

CMD=""
MACHINE=""
SCOPE="all"
DO_BUILD=1
DO_WATCH=0
DO_RESTART=0

SYNC_PACKAGES=1
SYNC_FRONTEND=1

normalize_scope() {
  case "$1" in
    all|a|packages|pkg|p|frontend|front|fe|f|"") echo "packages" ;;
    *)
      echo "错误：未知同步范围 '$1'（all / packages）" >&2
      exit 2
      ;;
  esac
}

apply_scope() {
  SCOPE="$(normalize_scope "${SCOPE}")"
  SYNC_PACKAGES=1
  SYNC_FRONTEND=0
}

parse_flags() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --no-build) DO_BUILD=0 ;;
      --watch) DO_WATCH=1 ;;
      --restart) DO_RESTART=1 ;;
      -h|--help) usage; exit 0 ;;
      *)
        echo "未知选项: $1（见 help）" >&2
        exit 2
        ;;
    esac
    shift
  done
}

if [[ $# -eq 0 ]]; then
  usage
  exit 2
fi

case "$1" in
  list|ls)
    CMD="list"
    shift
    ;;
  info)
    CMD="info"
    shift
    [[ $# -gt 0 ]] || { echo "错误：info 需要机器号，例如：info 1" >&2; exit 2; }
    MACHINE="$1"
    shift
    ;;
  help|-h|--help)
    usage
    exit 0
    ;;
  discover)
    CMD="discover"
    shift
    [[ $# -gt 0 ]] || { echo "错误：discover 需要机器号，例如：discover 1" >&2; exit 2; }
    MACHINE="$1"
    shift
    ;;
  sync)
    CMD="sync"
    shift
    [[ $# -gt 0 ]] || { echo "错误：sync 需要机器号，例如：sync 1 packages" >&2; exit 2; }
    MACHINE="$1"
    shift
    if [[ $# -gt 0 && "$1" != --* ]]; then
      SCOPE="$1"
      shift
    fi
    parse_flags "$@"
    ;;
  [0-9]*)
    CMD="sync"
    MACHINE="$1"
    shift
    if [[ $# -gt 0 && "$1" != --* ]]; then
      SCOPE="$1"
      shift
    fi
    parse_flags "$@"
    ;;
  *)
    echo "未知命令: $1（见 help）" >&2
    exit 2
    ;;
esac

require_machines_file() {
  if [[ ! -f "${MACHINES_FILE}" ]]; then
    echo "错误：未找到机器清单 ${MACHINES_FILE}" >&2
    echo "请复制：cp ${SCRIPT_DIR}/machines.example.json ${SCRIPT_DIR}/machines.json" >&2
    exit 1
  fi
}

json_get_machines() {
  require_machines_file
  python3 - "${MACHINES_FILE}" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
machines = data.get("machines")
if not isinstance(machines, list) or not machines:
    sys.exit("machines.json 缺少 machines 数组")
for m in machines:
    mid = m.get("id")
    if mid is None:
        sys.exit("机器条目缺少 id")
    name = (m.get("name") or f"机器{mid}").replace("\t", " ")
    profile = (m.get("profile") or "").replace("\t", " ")
    olares_id = (m.get("olares_id") or "").replace("\t", " ")
    ssh = (m.get("ssh") or m.get("lan_ip") or "").replace("\t", " ")
    # Placeholder keeps empty dest_dir from collapsing under bash IFS=tab read.
    dest = (m.get("dest_dir") or "(auto)").replace("\t", " ")
    ns = (m.get("kube_ns") or "-").replace("\t", " ")
    print(f"{mid}\t{name}\t{profile}\t{olares_id}\t{ssh}\t{dest}\t{ns}")
PY
}

cmd_list() {
  local id name profile olares_id ssh dest ns
  printf '%-4s %-8s %-14s %-28s %-16s %s\n' "ID" "NAME" "PROFILE" "OLARES_ID" "SSH" "KUBE_NS"
  while IFS=$'\t' read -r id name profile olares_id ssh dest ns; do
    printf '%-4s %-8s %-14s %-28s %-16s %s\n' \
      "${id}" "${name}" "${profile:-"-"}" "${olares_id:-"-"}" "${ssh:-"(local)"}" "${ns:-"-"}"
  done < <(json_get_machines)
}

cmd_info() {
  require_machines_file
  python3 - "${MACHINES_FILE}" "${MACHINE}" <<'PY'
import json, sys

path, want = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
machines = data.get("machines") or []
m = next((x for x in machines if str(x.get("id")) == want), None)
if m is None:
    sys.exit(f"machines.json 中没有 id={want} 的机器")

login = m.get("login") or {}
lan = m.get("lan_ip") or m.get("ssh") or ""
ssh_user = login.get("ssh_user") or "olares"
root_ssh = (login.get("root_ssh") or "").strip()

print(f"机器 {m.get('id')}  {m.get('name') or ''}")
print(f"  profile:          {m.get('profile') or '-'}")
print(f"  olares_id:        {m.get('olares_id') or '-'}")
print(f"  desktop_url:      {m.get('desktop_url') or '-'}")
print(f"  lan_ip:           {lan or '-'}")
print(f"  kube_ns:          {m.get('kube_ns') or '-'}")
print(f"  dest_dir:         {m.get('dest_dir') or '(auto)'}")
print(f"  sync ssh:         {m.get('ssh') or lan or '(local)'}")
print("  login:")
print(f"    olares_password: {login.get('olares_password') or '(unset)'}")
print(f"    ssh_user:        {ssh_user}")
print(f"    ssh_password:    {login.get('ssh_password') or '(unset)'}")
print(f"    root_ssh:        {root_ssh or '(default root@IP key)'}")
print("  tips:")
print(f"    olares-cli profile use {m.get('profile') or '<profile>'}")
print(f"    ssh {ssh_user}@{lan or '<ip>'}")
if root_ssh.startswith("key "):
    key = root_ssh[4:].strip()
    print(f"    ssh -i {key} root@{lan or '<ip>'}")
else:
    print(f"    ssh root@{lan or '<ip>'}")
print(f"    scripts/dev-sync/sync.sh {m.get('id')}")
PY
}

load_machine() {
  local want="$1"
  local id name profile olares_id ssh dest ns found=0
  while IFS=$'\t' read -r id name profile olares_id ssh dest ns; do
    if [[ "${id}" == "${want}" ]]; then
      MACHINE_NAME="${name}"
      DEST_SSH="${ssh}"
      DEST_DIR="${dest}"
      KUBE_NS="${ns}"
      [[ "${DEST_DIR}" == "(auto)" ]] && DEST_DIR=""
      [[ "${KUBE_NS}" == "-" ]] && KUBE_NS=""
      found=1
      break
    fi
  done < <(json_get_machines)
  if [[ "${found}" -ne 1 ]]; then
    echo "错误：machines.json 中没有 id=${want} 的机器。可用：scripts/dev-sync/sync.sh list" >&2
    exit 1
  fi
}

SSH_OPTS=(
  -o BatchMode=yes
  -o ConnectTimeout=15
  -o ServerAliveInterval=20
  -o ServerAliveCountMax=3
)
RSYNC_SSH="ssh ${SSH_OPTS[*]}"

normalize_dest_ssh() {
  local s="${1-}"
  [[ -z "${s}" ]] && { echo ""; return 0; }
  if [[ "${s}" == *@* ]]; then
    echo "${s}"
  else
    echo "root@${s}"
  fi
}

_remote_sh() {
  local cmd="$1"
  if [[ -n "${DEST_SSH}" ]]; then
    # shellcheck disable=SC2029
    ssh "${SSH_OPTS[@]}" "${DEST_SSH}" "${cmd}"
  else
    bash -lc "${cmd}"
  fi
}

_kube() {
  local args=("$@")
  if [[ -z "${KUBE_NS-}" ]]; then
    return 1
  fi
  local joined
  printf -v joined '%q ' "${args[@]}"
  if [[ -n "${DEST_SSH}" ]]; then
    # shellcheck disable=SC2029
    ssh "${SSH_OPTS[@]}" "${DEST_SSH}" \
      "kubectl -n $(printf '%q' "${KUBE_NS}") --request-timeout=20s ${joined}"
  else
    kubectl -n "${KUBE_NS}" --request-timeout=20s "${args[@]}"
  fi
}

_kube_exec_health() {
  _kube exec "deploy/${APP_NAME}" -c "${APP_NAME}" -- \
    node -e 'fetch("http://127.0.0.1:8080/api/health").then((r)=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'
}

discover_dest_dir() {
  local ns_suffix=""
  if [[ -n "${KUBE_NS-}" && "${KUBE_NS}" == "${APP_NAME}-"* ]]; then
    ns_suffix="${KUBE_NS#${APP_NAME}-}"
  fi

  local find_cmd
  if [[ -n "${ns_suffix}" ]]; then
    find_cmd="find /olares/rootfs/userspace /olares/userdata /data -maxdepth 8 -type d -path '*${ns_suffix}*/Data/${APP_NAME}/devsrc' 2>/dev/null | head -n 5"
  else
    find_cmd="find /olares/rootfs/userspace /olares/userdata /data -maxdepth 8 -type d -path '*/Data/${APP_NAME}/devsrc' 2>/dev/null | head -n 5"
  fi

  local found
  found="$(_remote_sh "${find_cmd}" || true)"
  if [[ -z "${found}" ]]; then
    return 1
  fi
  local first count
  first="$(printf '%s\n' "${found}" | head -n 1)"
  count="$(printf '%s\n' "${found}" | grep -c . || true)"
  if [[ "${count}" -gt 1 ]]; then
    log "!! 发现多个 devsrc，使用第一条；请在 machines.json 显式写 dest_dir："
    printf '%s\n' "${found}" | sed 's/^/    /' >&2
  fi
  echo "${first}"
}

ensure_dest_dir() {
  if [[ -n "${DEST_DIR}" ]]; then
    return 0
  fi
  log "dest_dir 未设置，尝试自动发现…"
  if DEST_DIR="$(discover_dest_dir)"; then
    log "自动发现 DEST_DIR=${DEST_DIR}"
  else
    echo "错误：未设置 dest_dir，且自动发现失败。请先安装 hotReload=true 的 chart，或编辑 ${MACHINES_FILE}" >&2
    exit 1
  fi
}

# App root layout at DEST_DIR (/app): package.json, dist/, packages/{service,core,web,mobile,skills}
APP_ROOT="${REPO_ROOT}"

RSYNC_EXCLUDES=(
  --exclude 'node_modules/'
  --exclude '.next/'
  --exclude '.git/'
  --exclude '.cursor/'
  --exclude '_参考/'
  --exclude 'deploy/'
  --exclude 'scripts/'
  --exclude 'tests/'
  --exclude 'coverage/'
  --exclude '.env'
  --exclude '.env.*'
  --exclude '*.md'
  --exclude '*.log'
  --exclude '.lares-reload'
  --exclude '.lares-lock-sha'
  # Image identity stamped by seed-dev-src; deleting it makes the next pod
  # re-seed devsrc from the image and discard everything synced here.
  --exclude '.lares-image-id'
  # olares-* 技能只存在于镜像里（构建期 olares-cli skills export 写入），本地树
  # 没有；不排除的话 --delete 会在每次热同步时把它们从 /app 删掉。
  --exclude 'packages/skills/olares-*'
  --exclude 'packages/skills/.olares-cli-suite'
  --exclude 'artifacts/'
  --exclude '*.tgz'
  --exclude 'Dockerfile'
  --exclude 'Dockerfile.base'
  --exclude 'project.json'
  --exclude '.dockerignore'
  --exclude '.gitignore'
  --exclude '.cursorignore'
)

wait_api_ready() {
  if [[ "${SYNC_PACKAGES}" -ne 1 ]]; then
    return 0
  fi
  if [[ -z "${KUBE_NS-}" ]]; then
    return 0
  fi
  local max_wait=40
  log "等待热重载后 API 就绪（最多 ${max_wait}s）"
  local i
  for i in $(seq 1 "${max_wait}"); do
    if _kube_exec_health >/dev/null 2>&1; then
      log "API 已就绪（约 ${i}s）"
      return 0
    fi
    sleep 1
  done
  log "!! API 就绪等待超时，请稍后手动确认（必要时 --restart）"
}

sync_once() {
  local remote_prefix=""
  local rsh_opt=()
  if [[ -n "${DEST_SSH}" ]]; then
    remote_prefix="${DEST_SSH}:"
    rsh_opt=(-e "${RSYNC_SSH}")
  fi

  if [[ "${SYNC_PACKAGES}" -eq 1 ]]; then
    if [[ "${DO_BUILD}" -eq 1 ]]; then
      log "本地构建（产物写入 dist/）"
      ( cd "${APP_ROOT}" && npm run build )
    fi

    if [[ -n "${DEST_SSH}" ]]; then
      log "准备远端目录 ${DEST_DIR}"
      _remote_sh "mkdir -p $(printf '%q' "${DEST_DIR}")"
    else
      mkdir -p "${DEST_DIR}"
    fi

    log "同步应用根 → ${remote_prefix}${DEST_DIR}/（保留远端 node_modules）"
    rsync -az --delete "${rsh_opt[@]}" "${RSYNC_EXCLUDES[@]}" \
      "${APP_ROOT}/" "${remote_prefix}${DEST_DIR}/"

    # rsync -a 保留本机 uid/gid，文件落地成 macOS 的 501:staff；容器以 node(1000)
    # 运行。同步后把源码归 1000:1000（对齐 Dockerfile USER node 与 fix-dev-perms）；
    # 排除量大且已属 node 的 node_modules。macOS 自带 rsync 太老，没有
    # --chown，故在此显式 chown 而非交给 rsync。
    local chown_cmd
    printf -v chown_cmd 'find %q \( -name node_modules -o -name .next \) -prune -o -print0 | xargs -0 chown 1000:1000' "${DEST_DIR}"
    _remote_sh "${chown_cmd}"

    # Hot sync keeps remote node_modules; when package-lock changes, install inside
    # the running pod so new cordis plugins resolve without rebuilding the image.
    if [[ -n "${KUBE_NS-}" ]]; then
      local lock_hash want_hash
      want_hash="$(shasum -a 256 "${APP_ROOT}/package-lock.json" 2>/dev/null | awk '{print $1}')"
      lock_hash="$(_remote_sh "cat $(printf '%q' "${DEST_DIR}/.lares-lock-sha") 2>/dev/null || true" | tr -d '[:space:]')"
      if [[ -n "${want_hash}" && "${want_hash}" != "${lock_hash}" ]]; then
        log "package-lock 变更 → 容器内 npm install"
        if _kube exec "deploy/${APP_NAME}" -c "${APP_NAME}" -- \
          sh -c 'cd /app && npm install --omit=dev'; then
          _remote_sh "printf '%s' $(printf '%q' "${want_hash}") > $(printf '%q' "${DEST_DIR}/.lares-lock-sha") && chown 1000:1000 $(printf '%q' "${DEST_DIR}/.lares-lock-sha")"
        else
          echo "错误：容器内 npm install 失败；未触发热重载，避免用不完整依赖启动" >&2
          return 1
        fi
      fi
    fi

    # Bump the reload sentinel; the in-container dev supervisor polls its mtime
    # (inotify does not fire for hostPath writes) and re-execs the server.
    _remote_sh "touch $(printf '%q' "${DEST_DIR}/.lares-reload")"
  fi

  if [[ "${DO_RESTART}" -eq 1 ]]; then
    if [[ -z "${KUBE_NS-}" ]]; then
      log "!! --restart 需要 kube_ns"
    else
      log "重启 pod（兜底，绕过 inotify）"
      _kube rollout restart "deploy/${APP_NAME}"
    fi
  fi

  wait_api_ready

  log "完成：${remote_prefix}${DEST_DIR}（scope=${SCOPE}）"
}

case "${CMD}" in
  list)
    cmd_list
    exit 0
    ;;
  info)
    cmd_info
    exit 0
    ;;
  discover|sync)
    load_machine "${MACHINE}"
    DEST_SSH="$(normalize_dest_ssh "${DEST_SSH-}")"
    DEST_DIR="${DEST_DIR-}"
    KUBE_NS="${KUBE_NS-}"
    apply_scope
    ;;
esac

if [[ "${CMD}" == "discover" ]]; then
  log "机器${MACHINE} ${MACHINE_NAME}"
  log "DEST_SSH=${DEST_SSH:-"(local)"}"
  log "KUBE_NS=${KUBE_NS:-"(unset)"}"
  if [[ -n "${DEST_DIR}" ]]; then
    log "DEST_DIR=${DEST_DIR}（已配置）"
  else
    if d="$(discover_dest_dir)"; then
      log "DEST_DIR=${d}（自动发现）"
    else
      log "DEST_DIR=未能自动发现"
      exit 1
    fi
  fi
  exit 0
fi

ensure_dest_dir

log "目标 机器${MACHINE}(${MACHINE_NAME}) scope=${SCOPE}  DEST_SSH=${DEST_SSH:-"(local)"}  DEST_DIR=${DEST_DIR}  KUBE_NS=${KUBE_NS:-"(unset)"}"
sync_once

if [[ "${DO_WATCH}" -eq 1 ]]; then
  if ! command -v fswatch >/dev/null 2>&1; then
    echo "错误：--watch 需要 fswatch（macOS: brew install fswatch）" >&2
    exit 1
  fi
  log "监听中（Ctrl-C 退出）：按 scope=${SCOPE} 自动同步"
  local_watch_paths=("${REPO_ROOT}/packages")
  fswatch -o \
    --exclude='node_modules' \
    --exclude='.next' \
    "${local_watch_paths[@]}" | while read -r _; do
    log "--- 检测到变更，重新同步 ---"
    sync_once || log "!! 本次同步失败，等待下次变更"
  done
fi
