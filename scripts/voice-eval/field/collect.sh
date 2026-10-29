#!/usr/bin/env bash
# Follows the robot's conversation log, Lares's log and Router's backend log into <out-dir> while
# someone tests the robot by voice. Stop it with Ctrl-C (or kill) when the test ends.
#
#   scripts/voice-eval/field/collect.sh <out-dir>
#
# Pods are looked up again whenever a follow ends: a GPU-mode switch or an upgrade replaces them.
# Restarted follows re-read the last ten minutes, so the files hold duplicates; analyze.py drops them.
set -u
out=${1:?usage: collect.sh <out-dir>}
mkdir -p "$out"
cli=${OLARES_CLI:-olares-cli}
follow() { # namespace container file
  while true; do
    pod=$("$cli" cluster pod list -n "$1" </dev/null 2>/dev/null | awk 'NR>1 && $3=="Running" {print $1; exit}')
    [ -n "$pod" ] && "$cli" cluster pod logs "$1/$pod" -c "$2" --since 10m --tail 0 -f --interval 3s </dev/null >> "$out/$3" 2>>"$out/collect.err"
    sleep 10
  done
}
follow "${REACHY_NAMESPACE:-reachymini-pptest03}" reachymini robot.log &
follow "${LARES_NAMESPACE:-lares-pptest03}" lares lares.log &
follow "${ROUTER_NAMESPACE:-router-shared}" router-backend router.log &
trap 'kill 0' INT TERM
wait
