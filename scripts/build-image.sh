#!/usr/bin/env bash
# Build the Dina image for linux/amd64.
# 测试期默认 --load（本机）；禁止默认 --push。发版才加 --push。
#
# Usage:
#   scripts/build-image.sh                    # local load
#   scripts/build-image.sh --push             # 仅明确发版时
#   scripts/build-image.sh --image repo:tag
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/project.sh
source "$ROOT/scripts/lib/project.sh"

VERSION="$(awk '/^version:/{print $2; exit}' "$CHART_DIR/Chart.yaml")"
IMAGE="${IMAGE:-${IMAGE_REPO}:${VERSION}}"
# Olares nodes are amd64; building on an Apple Silicon Mac would otherwise
# produce an arm64 image that silently fails to start on the cluster.
PLATFORM="${PLATFORM:-linux/amd64}"
DO_PUSH=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push) DO_PUSH=1 ;;
    --image)
      shift
      IMAGE="$1"
      ;;
    -h|--help)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

cd "$ROOT"
echo "Building $IMAGE for $PLATFORM (Dina shell + Router)"
if [[ "$DO_PUSH" -eq 1 ]]; then
  echo "WARNING: --push 仅用于明确发版；测试请改用 scripts/deploy-image.sh <机器号>"
  docker buildx build --platform "$PLATFORM" -t "$IMAGE" --push .
else
  docker buildx build --platform "$PLATFORM" -t "$IMAGE" --load .
fi

echo "Done: $IMAGE"
echo "deploy/${APP_NAME}/values.yaml must reference this exact tag."
if [[ "$DO_PUSH" -eq 0 ]]; then
  echo "测试分发: scripts/deploy-image.sh <机器号>   # save + SSH + ctr import"
fi
