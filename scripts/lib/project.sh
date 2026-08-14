# shellcheck shell=bash
# Load project identity from repo-root project.json.
# Exports: APP_NAME APP_TITLE IMAGE_REPO NPM_SCOPE CHART_DIR PROJECT_ROOT
#
# Usage (from any bash script under scripts/):
#   # shellcheck source=scripts/lib/project.sh
#   source "$REPO_ROOT/scripts/lib/project.sh"

_this="${BASH_SOURCE[0]-}"
if [[ -z "${_this}" && -n "${ZSH_VERSION-}" ]]; then
  # zsh: %x is the sourced file path when this file is sourced
  # shellcheck disable=SC2296
  _this="${(%):-%x}"
fi
if [[ -z "${_this}" ]]; then
  echo "error: cannot resolve scripts/lib/project.sh path" >&2
  return 1 2>/dev/null || exit 1
fi

_project_sh_dir="$(cd "$(dirname "${_this}")" && pwd)"
PROJECT_ROOT="$(cd "${_project_sh_dir}/../.." && pwd)"
unset _this _project_sh_dir

_project_json="${PROJECT_ROOT}/project.json"
if [[ ! -f "${_project_json}" ]]; then
  echo "error: missing ${_project_json}" >&2
  return 1 2>/dev/null || exit 1
fi

eval "$(
  python3 - "${_project_json}" <<'PY'
import json, shlex, sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
name = data.get("name") or ""
title = data.get("title") or ""
image_repo = data.get("image_repo") or ""
npm_scope = data.get("npm_scope") or ""
if not name or not title or not image_repo:
    sys.exit("project.json must set name, title, image_repo")
print(f"APP_NAME={shlex.quote(name)}")
print(f"APP_TITLE={shlex.quote(title)}")
print(f"IMAGE_REPO={shlex.quote(image_repo)}")
print(f"NPM_SCOPE={shlex.quote(npm_scope)}")
PY
)"
unset _project_json

CHART_DIR="${PROJECT_ROOT}/deploy/${APP_NAME}"
