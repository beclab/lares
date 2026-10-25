"""Per-turn table for a robot field test; see analyze.sh. Arguments: <out-dir> <from> [<to>]."""
import json, re, sys, datetime as dt
R, since = sys.argv[1], sys.argv[2]
def ts(line):
    m = re.match(r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6})', line)
    return dt.datetime.fromisoformat(m.group(1) + '+00:00') if m else None
start = dt.datetime.fromisoformat(since.replace('Z', '+00:00'))
stop = dt.datetime.fromisoformat(sys.argv[3].replace('Z', '+00:00')) if len(sys.argv) > 3 and sys.argv[3] else dt.datetime.max.replace(tzinfo=dt.timezone.utc)

# Robot turns from the conversation log.
lines = sorted(set(open(f'{R}/robot.log', encoding='utf-8', errors='replace').read().splitlines()))
turns = []
for line in lines:
    t = ts(line)
    if not t or t < start or t >= stop or '[conversation]' not in line: continue
    if 'role=user content=' in line:
        turns.append({'t': t, 'user': line.split('role=user content=', 1)[1], 'tools': [], 'said': [], 'created': None, 'audio': None, 'barge': False})
        continue
    if not turns: continue
    cur = turns[-1]
    if m := re.search(r'response\.created (\d+) ms', line): cur['created'] = cur['created'] or int(m.group(1))
    elif m := re.search(r'first audio delta (\d+) ms', line): cur['audio'] = cur['audio'] or int(m.group(1))
    elif m := re.search(r"Tool call received — tool_name='([^']+)'.*?args=(.*)", line): cur['tools'].append(f"{m.group(1).split('__')[-1]}({m.group(2)[:40]})")
    elif 'role=assistant content=' in line:
        said = line.split('role=assistant content=', 1)[1]
        if not said.startswith(('🛠️', '{')): cur['said'].append(said)
    elif 'User intervention' in line: cur['barge'] = True

# Lares records: delegations and task results, matched to the turn they follow.
records = [json.loads(l) for l in open(f'{R}/records.jsonl', encoding='utf-8') if l.strip()]
for r in records: r['t'] = dt.datetime.fromtimestamp(r['at'] / 1000, dt.timezone.utc)
for i, turn in enumerate(turns):
    end = turns[i + 1]['t'] if i + 1 < len(turns) else turn['t'] + dt.timedelta(minutes=5)
    tasks = [r for r in records if r['role'] == 'task' and turn['t'] - dt.timedelta(seconds=2) <= r['t'] < end + dt.timedelta(seconds=90)]
    asked = [r for r in tasks if not r['text'].startswith('{') and turn['t'] - dt.timedelta(seconds=2) <= r['t'] < end]
    turn['task'] = asked[0]['text'] if asked else None
    if asked:
        done = [r for r in tasks if r['text'].startswith('{') and r['taskId'] == asked[0]['taskId']]
        if done:
            body = json.loads(done[0]['text'])
            turn['result'] = (body.get('status'), (body.get('text') or body.get('error') or '')[:40].replace('\n', ' '), round((done[0]['t'] - turn['t']).total_seconds(), 1))

# Router chat calls: the dialogue's calls carry tool_choice, the Agent's carry max_completion_tokens.
calls = []
try:
    pending = {}
    for line in sorted(set(open(f'{R}/router.log', encoding='utf-8', errors='replace').read().splitlines())):
        t = ts(line)
        if not t or t < start or t >= stop: continue
        try: d = json.loads(line.split(' ', 1)[1])
        except Exception: continue
        m = d.get('message')
        if m in ('chat_stream completed', 'chat_completion forwarded (adapter)'):
            pending[line[:23]] = ('agent' if 'max_completion_tokens' in d.get('params', '') else 'voice', d.get('model'))
        elif m == 'http_request' and d.get('path') == '/v1/chat/completions':
            kind = pending.pop(line[:23], ('?', None))[0]
            calls.append({'end': t, 'start': t - dt.timedelta(milliseconds=d['latency_ms']), 'ms': d['latency_ms'], 'kind': kind})
except FileNotFoundError:
    pass
for i, turn in enumerate(turns):
    end = turns[i + 1]['t'] if i + 1 < len(turns) else turn['t'] + dt.timedelta(minutes=2)
    voice = [c for c in calls if c['kind'] == 'voice' and turn['t'] - dt.timedelta(seconds=1) <= c['start'] < end]
    turn['voice_ms'] = [c['ms'] for c in voice]
    turn['overlap'] = sum(1 for c in calls if c['kind'] == 'agent' and any(c['start'] < v['end'] and v['start'] < c['end'] for v in voice))

HOME = re.compile(r'灯|空调|开关|窗帘|插座|风扇|light|lamp|switch|fan|aircon|heater|curtain', re.I)
CLAIM = re.compile(r'(正在|已经|已|马上|这就|重新|为您|帮你).{0,6}(开|关|调|打开|关闭|调暗|调亮)|turning (on|off)|switched|turned (on|off)', re.I)
rows, flags = [], []
for turn in turns:
    path = 'ask_lares' if turn.get('task') else ', '.join(turn['tools']) or 'words'
    said = ' / '.join(turn['said'])[:60]
    res = turn.get('result')
    note = []
    if HOME.search(turn['user']) and not turn.get('task'): note.append('HOME NOT DELEGATED')
    if not turn.get('task') and CLAIM.search(said): note.append('CLAIMED ACTION, NO TOOL')
    if turn['created'] and turn['created'] > 3000: note.append(f"slow start {turn['created']}ms")
    if turn['audio'] and turn['audio'] > 5000: note.append(f"slow audio {turn['audio']}ms")
    if res and res[0] != 'completed': note.append(f'task {res[0]}')
    if turn['overlap']: note.append(f"agent busy x{turn['overlap']}")
    rows.append(f"| {turn['t']:%H:%M:%S} | {turn['user'][:28]} | {path[:40]} | {turn['created'] or '-'} | {turn['audio'] or '-'} | {'+'.join(map(str, turn['voice_ms'])) or '-'} | {said} | {(res[1] + f' ({res[2]}s)') if res else '-'} | {'; '.join(note)} |")
print('| time | user | path | created ms | first audio ms | dialogue calls ms | said | task result | flags |')
print('|---|---|---|---|---|---|---|---|---|')
print('\n'.join(rows))
aud = sorted(t['audio'] for t in turns if t['audio'])
by = {}
for t in turns:
    k = 'ask_lares' if t.get('task') else ('device tool' if t['tools'] else 'words')
    if t['audio']: by.setdefault(k, []).append(t['audio'])
med = lambda v: sorted(v)[len(v) // 2]
print(f"\nturns {len(turns)}; first audio median {med(aud) if aud else '-'} ms, max {aud[-1] if aud else '-'} ms")
for k, v in by.items(): print(f"  {k}: n={len(v)} median {med(v)} ms, max {max(v)} ms")
solo = [t['voice_ms'][0] for t in turns if t['voice_ms'] and not t['overlap']]
busy = [t['voice_ms'][0] for t in turns if t['voice_ms'] and t['overlap']]
if solo: print(f"  first dialogue call, Agent idle: n={len(solo)} median {med(solo)} ms")
if busy: print(f"  first dialogue call, Agent running: n={len(busy)} median {med(busy)} ms")
res = [t['result'][2] for t in turns if t.get('result')]
if res: print(f"  task result after user turn: median {med(res)} s, max {max(res)} s")
