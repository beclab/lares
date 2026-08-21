#!/usr/bin/env bash
# Build the Lares images for linux/amd64.
# 默认只打应用层（代码）；底座（OS / CLI / node_modules）用 --base。
# 测试期默认 --load（本机）；禁止默认 --push。发版才加 --push。
#
# Usage:
#   scripts/build-image.sh                    # 应用层；本地无底座时会先打底座
#   scripts/build-image.sh --base             # 先重建底座，再打应用层
#   scripts/build-image.sh --push             # 仅明确发版时
#   scripts/build-image.sh --image repo:tag
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/project.sh
source "$ROOT/scripts/lib/project.sh"

VERSION="$(awk '/^version:/{print $2; exit}' "$CHART_DIR/Chart.yaml")"
IMAGE="${IMAGE:-${IMAGE_REPO}:${VERSION}}"
BASE_IMAGE="${BASE_IMAGE:-${IMAGE_BASE_REPO}:${IMAGE_BASE_TAG}}"
# Olares nodes are amd64; building on an Apple Silicon Mac would otherwise
# produce an arm64 image that silently fails to start on the cluster.
PLATFORM="${PLATFORM:-linux/amd64}"
DO_PUSH=0
DO_BASE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push) DO_PUSH=1 ;;
    --base) DO_BASE=1 ;;
    --image)
      shift
      IMAGE="$1"
      ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

build_one() {
  local extra=()
  if [[ "$DO_PUSH" -eq 1 ]]; then
    extra+=(--push)
  else
    extra+=(--load)
  fi
  docker buildx build --platform "$PLATFORM" "${extra[@]}" "$@"
}

cd "$ROOT"

if [[ "$DO_BASE" -eq 0 ]] && ! docker image inspect "$BASE_IMAGE" >/dev/null 2>&1; then
  echo "本地没有底座 ${BASE_IMAGE}，先构建底座"
  DO_BASE=1
fi

if [[ "$DO_BASE" -eq 1 ]]; then
  echo "Building base $BASE_IMAGE for $PLATFORM (OS + CLI + npm deps)"
  if [[ "$DO_PUSH" -eq 1 ]]; then
    echo "WARNING: --push 仅用于明确发版；测试请改用 scripts/deploy-image.sh <机器号>"
  fi
  build_one -f Dockerfile.base -t "$BASE_IMAGE" .
fi

echo "Building app $IMAGE from $BASE_IMAGE for $PLATFORM"
if [[ "$DO_PUSH" -eq 1 ]]; then
  echo "WARNING: --push 仅用于明确发版；测试请改用 scripts/deploy-image.sh <机器号>"
fi
build_one -f Dockerfile --build-arg "BASE_IMAGE=$BASE_IMAGE" -t "$IMAGE" .

echo "Done: $IMAGE"
echo "base: $BASE_IMAGE"
echo "deploy/${APP_NAME}/values.yaml must reference the app tag."
if [[ "$DO_PUSH" -eq 0 ]]; then
  echo "测试分发: scripts/deploy-image.sh <机器号>   # save + SSH + ctr import"
fi
