#!/usr/bin/env bash
# Package Olares Chart only (no source files). App code ships in the container image.
#
# Usage:
#   scripts/package-chart.sh                  release package（仅明确发版时）
#   scripts/package-chart.sh --dev            测试用 upload 包（hotReload=true）
#   scripts/package-chart.sh --dev 0.10.4     same, with an explicit package version
#
# 测试期：--dev → market upload → install -s upload。禁止默认上公共市场。
# Dev packages take the next patch version so they outrank the released chart in
# the upload bucket. They keep pointing at the released image tag; runtime code
# comes from the hot-reload volume (sync.sh), not from daily image pushes.
#
# The version must be plain MAJOR.MINOR.PATCH. app-service resolves the chart
# through the Helm index with an empty version, which semver treats as the `*`
# constraint, and `*` never matches a prerelease — a `-dev.x` suffix installs
# with "no chart version found for <app>-" no matter what is in the index.
set -euo pipefail

DEV=0
DEV_VERSION=""
case "${1-}" in
  "") ;;
  --dev)
    DEV=1
    DEV_VERSION="${2-}"
    ;;
  *)
    echo "unknown option: $1 (use --dev [version])" >&2
    exit 2
    ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/project.sh
source "$ROOT/scripts/lib/project.sh"

CHART_SRC="$CHART_DIR"
VERSION="$(awk '/^version:/{print $2; exit}' "$CHART_SRC/Chart.yaml")"
DIST="$ROOT/artifacts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Olares resolves the image before install without rendering templates, so the
# literal tag in values.yaml must match the chart version being shipped.
IMAGE_TAG="$(awk -F: '/^image:/{print $3; exit}' "$CHART_SRC/values.yaml")"
MANIFEST_VERSION="$(awk '/^  version:/{print $2; exit}' "$CHART_SRC/OlaresManifest.yaml")"
for name in IMAGE_TAG MANIFEST_VERSION; do
  if [[ "${!name}" != "$VERSION" ]]; then
    echo "version mismatch: Chart.yaml=$VERSION but $name=${!name}" >&2
    exit 1
  fi
done

mkdir -p "$DIST" "$TMP/$APP_NAME"
cp "$CHART_SRC/Chart.yaml" "$TMP/$APP_NAME/"
cp "$CHART_SRC/OlaresManifest.yaml" "$TMP/$APP_NAME/"
cp "$CHART_SRC/values.yaml" "$TMP/$APP_NAME/"
cp -R "$CHART_SRC/templates" "$TMP/$APP_NAME/"

PKG_VERSION="$VERSION"
if [[ "$DEV" -eq 1 ]]; then
  if [[ -z "$DEV_VERSION" ]]; then
    DEV_VERSION="$(awk -F. '{print $1"."$2"."$3+1}' <<<"${VERSION%%-*}")"
  fi
  if [[ ! "$DEV_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "dev version must be plain MAJOR.MINOR.PATCH (no prerelease): $DEV_VERSION" >&2
    exit 1
  fi
  # The market stores versions in a varchar(16) column and rejects anything longer
  # with an opaque HTTP 400 at upload time.
  if [[ "${#DEV_VERSION}" -gt 16 ]]; then
    echo "dev version too long (${#DEV_VERSION} > 16): $DEV_VERSION" >&2
    exit 1
  fi
  PKG_VERSION="$DEV_VERSION"
  python3 - "$TMP/$APP_NAME" "$PKG_VERSION" <<'PY'
import re
import sys
from pathlib import Path

chart_dir, version = Path(sys.argv[1]), sys.argv[2]


def patch(name: str, *rules: tuple[str, str]) -> None:
    path = chart_dir / name
    text = path.read_text(encoding="utf-8")
    for pattern, replacement in rules:
        text, hits = re.subn(pattern, replacement, text, flags=re.MULTILINE)
        if hits != 1:
            sys.exit(f"{name}: expected 1 match for {pattern!r}, found {hits}")
    path.write_text(text, encoding="utf-8")


patch("values.yaml", (r"^(\s+hotReload:\s*)false\s*$", r"\g<1>true"))
patch("Chart.yaml", (r"^(version:\s*).+$", rf"\g<1>{version}"))
patch(
    "OlaresManifest.yaml",
    (r"^(  version:\s*).+$", rf"\g<1>{version}"),
    (r"^(  versionName:\s*).+$", rf'\g<1>"{version}"'),
)
PY
fi

PACKAGE="$DIST/$APP_NAME-$PKG_VERSION.tgz"
COPYFILE_DISABLE=1 tar -czf "$PACKAGE" -C "$TMP" "$APP_NAME"

echo "Packaged: $PACKAGE"
echo "Push ${IMAGE_REPO}:$VERSION (linux/amd64) before installing."
if [[ "$DEV" -eq 1 ]]; then
  echo "Install: olares-cli market upload $PACKAGE && olares-cli market install $APP_NAME -s upload --version $PKG_VERSION --watch"
fi
if command -v olares-cli >/dev/null 2>&1; then
  olares-cli chart lint "$PACKAGE"
fi
