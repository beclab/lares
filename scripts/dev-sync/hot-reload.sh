#!/usr/bin/env bash
# ==============================================================================
# 运行期切换热更新（免重新打包、免卸载重装）
#
# 用法：
#   scripts/dev-sync/hot-reload.sh status <n>
#   scripts/dev-sync/hot-reload.sh on <n>      # 跑镜像外的 devsrc 代码
#   scripts/dev-sync/hot-reload.sh off <n>     # 跑镜像里的代码
#
# on/off = 在 devsrc 里建 / 删 .hotreload，再重启 pod；容器入口只在
# 启动时读一次这个文件，决定跑镜像码还是 overlay。chart 两种模式渲染完全一样，
# 所以切换不用重新打包、不用卸载重装。
# 打开后首次启动会从镜像播种 devsrc（含 node_modules），可能要一两分钟。
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=scripts/lib/project.sh
source "${REPO_ROOT}/scripts/lib/project.sh"

usage() {
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
}

ACTION="${1-}"
MACHINE="${2-}"
case "${ACTION}" in
  on|off|status) ;;
  help|-h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
[[ -n "${MACHINE}" ]] || { echo "错误：需要机器号，例如：${ACTION} 1" >&2; exit 2; }

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

# Machine resolution (machines.json + devsrc discovery) lives in sync.sh.
eval "$("${SCRIPT_DIR}/sync.sh" discover "${MACHINE}" --sh)"
FLAG="${DEST_DIR}/.hotreload"
if [[ "${ACTION}" != "status" && -z "${KUBE_NS}" ]]; then
  echo "错误：切换热更新需要 machines.json 配置 kube_ns" >&2
  exit 1
fi

SSH_OPTS=(
  -o BatchMode=yes
  -o ConnectTimeout=15
  -o ServerAliveInterval=20
  -o ServerAliveCountMax=3
)

remote_sh() {
  if [[ -n "${DEST_SSH}" ]]; then
    # shellcheck disable=SC2029
    ssh -n "${SSH_OPTS[@]}" "${DEST_SSH}" "$1"
  else
    bash -lc "$1"
  fi
}

kube() {
  [[ -n "${KUBE_NS}" ]] || return 1
  local joined request_timeout="${KUBE_REQUEST_TIMEOUT:-20s}"
  printf -v joined '%q ' "$@"
  remote_sh "kubectl -n $(printf '%q' "${KUBE_NS}") --request-timeout=$(printf '%q' "${request_timeout}") ${joined}"
}

is_on() {
  remote_sh "test -e $(printf '%q' "${FLAG}")" 2>/dev/null
}

switch_to() {
  local want="$1" max_wait=360
  # The container reads the flag once at boot, so the switch needs a restart.
  log "重启 deploy/${APP_NAME}"
  kube rollout restart "deploy/${APP_NAME}" >/dev/null
  KUBE_REQUEST_TIMEOUT="$((max_wait + 10))s" \
    kube rollout status "deploy/${APP_NAME}" --timeout="${max_wait}s"
  if [[ "${want}" == "on" ]]; then
    kube exec "deploy/${APP_NAME}" -c "${APP_NAME}" -- \
      test -e /tmp/lares-hot-reload-active
  else
    kube exec "deploy/${APP_NAME}" -c "${APP_NAME}" -- \
      test ! -e /tmp/lares-hot-reload-active
  fi
  kube exec "deploy/${APP_NAME}" -c "${APP_NAME}" -- \
    node -e 'fetch("http://127.0.0.1:8080/api/health").then((r)=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'
  log "已切到 ${want}"
}

case "${ACTION}" in
  status)
    if is_on; then
      desired="on"
    else
      desired="off"
    fi
    active="unknown"
    if [[ -n "${KUBE_NS}" ]]; then
      active="$(kube exec "deploy/${APP_NAME}" -c "${APP_NAME}" -- \
        sh -c 'if test -e /tmp/lares-hot-reload-active; then echo on; else echo off; fi' \
        2>/dev/null | tr -d '[:space:]' || true)"
      [[ -n "${active}" ]] || active="unavailable"
    fi
    log "热更新：desired=${desired} active=${active}"
    remote_sh "ls -1 $(printf '%q' "${DEST_DIR}") 2>/dev/null | head -n 20" || true
    ;;
  on)
    remote_sh "touch $(printf '%q' "${FLAG}") && chown 1000:1000 $(printf '%q' "${FLAG}")"
    switch_to on
    log "下一步：scripts/dev-sync/sync.sh ${MACHINE}"
    ;;
  off)
    remote_sh "rm -f $(printf '%q' "${FLAG}")"
    switch_to off
    ;;
esac
