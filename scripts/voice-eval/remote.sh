#!/usr/bin/env bash
# Runs the voice eval inside a Lares pod from a workstation and fetches the results.
#
#   scripts/voice-eval/remote.sh <namespace/pod> <out-dir> <label>[=<dialogue.js>] ...  [-- <run.mjs args>]
#
#   scripts/voice-eval/remote.sh lares-pptest03/lares-7fcd65d4c9-74mwn ./eval-out base next=/path/dialogue.js -- --runs 5
#
# Each label is one run.mjs pass. A label with a file runs that working copy of dialogue.js, which is
# uploaded beside the real module as dialogue.<label>.js so its relative imports still resolve. The
# passes run one after another, detached in the pod, so a dropped exec connection does not stop them
# and two passes never share Router at the same time. <out-dir> gets <label>.txt and <label>.json, and
# compare.mjs prints them side by side.
#
# Needs olares-cli on PATH (OLARES_CLI overrides it). olares-cli exec refuses long commands, so files
# go up in base64 chunks; it also reads stdin, hence every </dev/null.
set -euo pipefail

pod=$1 out=$2; shift 2
labels=()
while [ $# -gt 0 ] && [ "$1" != "--" ]; do labels+=("$1"); shift; done
[ "${1:-}" = "--" ] && shift
[ ${#labels[@]} -gt 0 ] || { echo "usage: $0 <namespace/pod> <out-dir> <label>[=<dialogue.js>] ... [-- <run.mjs args>]" >&2; exit 2; }
cli=${OLARES_CLI:-olares-cli}
here=$(cd "$(dirname "$0")" && pwd)
run="/tmp/voice-eval-$(date +%s)"
pexec() { "$cli" cluster pod exec "$pod" -c lares -- "$@" </dev/null; }

# An exec that drops a chunk leaves a short file, so a failed checksum uploads again.
upload() {
  local attempt
  for attempt in 1 2 3; do upload_once "$@" && return 0; echo "retrying upload of $1" >&2; done
  exit 1
}

upload_once() {
  local src=$1 dst=$2 dir="$run/up-$RANDOM$RANDOM" i=0 chunk
  pexec mkdir -p "$dir" "$(dirname "$dst")"
  { base64 < "$src" | tr -d '\n' | tr '+/' '-_' | fold -w 1200; echo; } | while read -r chunk; do
    [ -n "$chunk" ] || continue
    i=$((i + 1))
    pexec sh -c "printf %s '$chunk' > $dir/$(printf %04d $i)"
  done
  local remote local_sum
  remote=$(pexec sh -c "cat $dir/* | tr -- '-_' '+/' | base64 -d > $dst && md5sum $dst" | cut -d' ' -f1) || true
  local_sum=$( (md5 -q "$src" 2>/dev/null || md5sum "$src" | cut -d' ' -f1) )
  [ "$remote" = "$local_sum" ] || { echo "upload of $src failed ($remote != $local_sum)" >&2; return 1; }
  echo "uploaded $(basename "$src") -> $dst"
}

for file in run.mjs scenarios.mjs compare.mjs; do upload "$here/$file" "/app/scripts/voice-eval/$file"; done

passes=""
for entry in "${labels[@]}"; do
  label=${entry%%=*} flags=""
  if [ "$entry" != "$label" ]; then
    upload "${entry#*=}" "/app/packages/core/voice/dialogue.$label.js"
    flags="--dialogue ../../packages/core/voice/dialogue.$label.js"
  fi
  passes="$passes node scripts/voice-eval/run.mjs $* $flags --json $run/$label.json > $run/$label.txt 2>&1;"
done
# An exec that fails its handshake can still have run, and a retry would start the passes twice
# into the same files; the lock directory lets only the first one through.
pexec sh -c "cd /app && nohup sh -c 'mkdir $run/lock || exit 0; $passes echo finished > $run/done' > /dev/null 2>&1 & echo started $run"

# A replaced pod loses /tmp with the passes in it, so a pod that stops answering ends the wait.
misses=0
until pexec cat "$run/done" 2>/dev/null | grep -q finished; do
  if pexec true 2>/dev/null; then misses=0; else misses=$((misses + 1)); fi
  [ $misses -lt 3 ] || { echo "$pod stopped answering; it was probably replaced, so run again on the new pod" >&2; exit 1; }
  sleep 30
done
mkdir -p "$out"
for entry in "${labels[@]}"; do
  label=${entry%%=*}
  pexec cat "$run/$label.txt" > "$out/$label.txt"
  pexec cat "$run/$label.json" > "$out/$label.json"
done
results=()
for entry in "${labels[@]}"; do results+=("$out/${entry%%=*}.json"); done
node "$here/compare.mjs" "${results[@]}"
