#!/usr/bin/env bash
# Regression check for the device dialogue: runs this checkout's dialogue.js against each model's
# stored baseline in the Lares pod and fails when a scenario or the total got worse.
#
#   scripts/voice-eval/regress.sh [--update] [--runs N] <model-id> ...
#
#   scripts/voice-eval/regress.sh Olares/cyankiwi/Qwen3.5-9B-AWQ-4bit
#   scripts/voice-eval/regress.sh --update Olares/cyankiwi/Qwen3.5-9B-AWQ-4bit    # after a release
#
# The pod is the first Running one in $LARES_NAMESPACE (default lares-pptest03). This checkout's
# packages/core/voice/dialogue.js goes up as a working copy beside the deployed module, so the rest
# of the pod's code is the deployed release: a change outside dialogue.js needs a release first.
# Each model must be served when the check runs (Router 404s a stopped one); stopping or starting
# engines is left to whoever runs this. Baselines live in scripts/voice-eval/baselines/<model>.json;
# --update replaces them with this run instead of gating. Results land in $OUT (default a temp dir).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
update=0 runs=5 models=()
while [ $# -gt 0 ]; do
  case "$1" in
    --update) update=1 ;;
    --runs) runs=$2; shift ;;
    *) models+=("$1") ;;
  esac
  shift
done
[ ${#models[@]} -gt 0 ] || { echo "usage: $0 [--update] [--runs N] <model-id> ..." >&2; exit 2; }
ns=${LARES_NAMESPACE:-lares-pptest03}
cli=${OLARES_CLI:-olares-cli}
pod=$("$cli" cluster pod list -n "$ns" </dev/null | awk 'NR>1 && $3=="Running" {print $1; exit}')
[ -n "$pod" ] || { echo "no running pod in $ns" >&2; exit 1; }
out=${OUT:-$(mktemp -d)}
status=0
for model in "${models[@]}"; do
  slug=$(printf %s "$model" | tr -c 'A-Za-z0-9._-' '_')
  dir="$out/$slug"
  "$here/remote.sh" "$ns/$pod" "$dir" "candidate=$root/packages/core/voice/dialogue.js" -- --runs "$runs" --model "$model" >/dev/null
  baseline="$here/baselines/$slug.json"
  if [ $update = 1 ]; then
    cp "$dir/candidate.json" "$baseline"
    node "$here/compare.mjs" "$baseline"
    echo "baseline updated: $baseline"
  elif [ -f "$baseline" ]; then
    if ! report=$(node "$here/compare.mjs" "$baseline" "$dir/candidate.json" --failures --gate); then
      printf '%s\n' "$report"
      # One 5-run pass is noisy: a flagged scenario has to fail again over ten runs to count.
      flagged=$(printf '%s\n' "$report" | sed -n 's/^flagged: //p')
      if [ -n "$flagged" ]; then
        echo "re-running $flagged ten times"
        "$here/remote.sh" "$ns/$pod" "$dir/again" "candidate=$root/packages/core/voice/dialogue.js" -- --runs 10 --only "$flagged" --model "$model" >/dev/null
        node "$here/compare.mjs" "$baseline" "$dir/again/candidate.json" --failures --gate --only-shared || status=1
      else
        status=1
      fi
    else
      printf '%s\n' "$report"
    fi
  else
    node "$here/compare.mjs" "$dir/candidate.json" --failures
    echo "no baseline for $model yet; rerun with --update to keep this one" >&2
  fi
done
echo "results: $out"
exit $status
