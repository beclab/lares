#!/usr/bin/env bash
# Turns a field test collected by collect.sh into one row per spoken turn: what the robot did (device
# tool, ask_lares or words), how long until it spoke, the dialogue's model calls and whether an Agent
# call ran at the same time, the task result, and flags for likely mistakes.
#
#   scripts/voice-eval/field/analyze.sh <out-dir> <from ISO time> [<to ISO time>]
#
# Task rows come from Lares's voice records in the pod, read once per run.
set -euo pipefail
out=${1:?usage: analyze.sh <out-dir> <from> [<to>]} since=${2:?from time required} until=${3:-}
cli=${OLARES_CLI:-olares-cli}
ns=${LARES_NAMESPACE:-lares-pptest03}
pod=$("$cli" cluster pod list -n "$ns" </dev/null | awk 'NR>1 && $3=="Running" {print $1; exit}')
"$cli" cluster pod exec "$ns/$pod" -c lares -- node -e "
const fs=require('fs'),path=require('path'),root='/data/lares/dsh-home/voice-records',since=Date.parse('$since');
for (const d of fs.readdirSync(root)) for (const f of fs.readdirSync(path.join(root,d))) { try { const j=JSON.parse(fs.readFileSync(path.join(root,d,f),'utf8')); for (const r of j.records||[]) if ((r.at||0)>since) console.log(JSON.stringify({role:r.role,text:r.text,taskId:r.taskId||'',status:r.status,at:r.at,voiceId:r.voiceId})); } catch {} }" </dev/null > "$out/records.jsonl"
python3 -I "$(dirname "$0")/analyze.py" "$out" "$since" "$until"
