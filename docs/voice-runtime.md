# Voice runtime

## Why a device Agent said "好的，我帮您关灯。" and stopped (2026-10-27)

Both devices send the Agent byte-identical requests (system prompt, the nine
`keepDeviceTools` tools, user message); Reachy only looked more reliable because
one robot connection keeps one Agent Session for 10-28 turns, and after the first
`skill(ha-lighting)` later light turns go straight to `bash`. Each glasses
connection opens a new Session, so every light request is a first step.

At that step Qwen3.5-9B (sglang 0.5.18, `qwen3_coder` parser, thinking off) says one
sentence and then picks `\n\n` + `<tool_call>` or `<|im_end|>`; the raw output of a
failed turn is the sentence and `<|im_end|>`, nothing lost by the parser. Next-token
probabilities after the sentence, measured with the assistant prefix filled in:

| Device Agent prompt | P(end) after "好的，我帮您打开灯。" | after "好的，我帮您关灯。" |
| --- | --- | --- |
| `SPOKEN_PROMPT` + `DEVICE_SPOKEN_PROMPT` (0.26.88-0.26.105) | 0.28 | 0.42 |
| `SPOKEN_PROMPT` only | 0.15 | 0.15 |
| only its "no markdown, headings, lists, links, citations, emoji" | 0.34 | 0.36 |
| only its "no advice or follow-up offers" | 0.30 | 0.36 |
| only "at most two short sentences", "small voice device" or units | 0.13-0.18 | 0.17-0.21 |

The engine sampled at the model's default temperature 1.0 (no temperature in its
`generation_config`, none in the Agent's request). A recorded light turn replayed
step by step with its tool results (light set to the opposite state):

| Prompt, temperature | On | Off |
| --- | --- | --- |
| with `DEVICE_SPOKEN_PROMPT`, 1.0 | 3/10 | — |
| with `DEVICE_SPOKEN_PROMPT`, 0 | 10/10 | 0/5 |
| `SPOKEN_PROMPT` only, 0.2 | 10/10 | 10/10 |
| only the length and units sentences, 0.2 | 10/10 | 8/10 |

0.26.106 gives a device's Agent `SPOKEN_PROMPT` only and temperature 0.2
(`deviceAgentRequest`, through the shim's request rewrite). Its formatting is left
to the device dialogue, which says a short plain result as written and turns
anything long or formatted, now including emoji, into one sentence. A clean sglang
restart did not change the first-step rate (1/6 executed), so engine state was not
the cause.

## A colour change that took 12 s: compacted skill instructions (2026-10-27)

On 0.26.106 "能帮我把灯变成黄色吗" (the second turn of a glasses Session) spent 12.0 s in
the Agent: ten wrong hass-cli commands (`--color_temp`, JSON in `--arguments`,
`service` without `call`), then `service --help` and `service describe` before
`hs_color` worked. Turning the light on or off in the same Session took 1.5-2 s.
The first turn had loaded `ha-lighting`, whose examples include
`--data '{"entity_id":…,"color_name":"yellow"}'`, but the device rewrite
(`compactEarlierToolResults`) replaced that 3,817-character result with a one-line
note once it fell behind the next user message. Replaying the second turn's first
step: with the skill result kept, 5/5 wrote the skill's `color_name` command; as
sent, 5/5 wrote `light/turn_on --entity … --color_temp 2000`. 0.26.107 keeps `skill`
results whole; other long results are still compacted. The dsh Session log itself
was never changed, only what each request sends.

## Device session without device tools: glasses on pptest03 (2026-10-27)

Glass Assistant (Rokid, or Meta glasses through the Olares Meta Voice phone app)
reaches Lares through Router model `lares-glass/voice-assistant`. It declares no
tools and commits each take itself (push-to-talk mode). On 0.26.102, with a key
without `clientTools`, it got the plain dialogue prompt: "你能帮我开一下灯吗？"
came back as "请问您需要开启的是哪个区域的灯光？" and no turn reached
`ask_lares`, because the device rules and checks were keyed on declared tools.

Now the key decides (`createVoiceDialogue({ device })` from
`voiceCaps.clientTools`): a `clientTools` key runs Reachy's device logic unchanged,
declared tools or not, with the same rule text. Devices differ only by profile
(caller instructions) and declared tools; the glasses send their own profile.
The eval table below was measured with an earlier variant (rules without the
gesture sentences, plus "never ask which one"), which was dropped to keep one
logic for every device.

Live eval on default-chat (Qwen3.5-9B AWQ), 5 runs per case, the field history
included (`field-*`: the session's own earlier turns):

| Case | Plain prompt | Glass caller instructions only | Device key (this change) |
| --- | --- | --- | --- |
| Light after the field history | 4/5 | 5/5 | 5/5, 5/5 |
| "你只有一个" after two clarifying replies | 2/5 | 2/5 | 3/5, 3/5 |
| Unclear chatter answered in a few words | 2/5 | 5/5 | 5/5 |
| Plain light requests (4 cases: zh ×2, a named room, en) | 20/20 | named room 3/5, en 3/5 | 17/20; the two cases that missed then 10/10 |
| All 11 cases | 42/55 | 42/55 | 49/55 |

With Reachy's rule text unchanged (0.26.105), the same 11 cases scored 48/55
without a profile and 47/55 with the glasses' profile: every Chinese light case
5/5, "你只有一个" after two clarifying replies 1–2/5. The device Agent can still
stop after "好的，我帮您打开灯。" without a tool call (1 of 2 live turn-on requests
on 2026-10-27, read-only light queries 3/3), as on the robot on 2026-10-25.

The Reachy subset (nod, light-on, light-after-ack, light-still-off, light-off-en,
3 runs) scored 13/15 with both the old and the new file, missing different cases.
The open problem is the glasses' microphone: people talking nearby become turns.

## Device voice through Router: Reachy Mini on pptest03 (2026-10-24/25)

Reachy Mini talks to Lares through Router, with its own tools (head, emotions,
dance, camera) kept as device tools and Home Assistant left to the Agent through
`ask_lares`. Releases 0.26.65–0.26.81 on `feat/ha-connection-leaked-tool-call`
(PR 67) were tested on the robot at pptest03; the path is:

```
Reachy conversation app (OpenAI Realtime client)
  -> reachymini realtime-gateway, compatible profile with the `lares` dialect (beclab/olares-reachymini#1)
  -> Router composite realtime model lares-reachy/voice-assistant (provider type openai)
  -> Lares /api/lares/voice/realtime on the internal webhook entrance (voice key with clientTools)
  -> dialogue on default-chat (sglang Qwen3.5-9B) + ask_lares -> dsh Agent -> hass-cli
     ASR Qwen3-ASR 0.6B (streaming), TTS Qwen3-TTS, Silero VAD in the Lares process
```

### What a device session does (0.26.81)

| Concern | Behaviour | Since |
| --- | --- | --- |
| Listening mode | `server_vad` without playback reports is a device; push-to-talk and hands-free keep their own rules (`core/voice/listening.js`) | 0.26.74 |
| Is someone speaking | Silero v5 per 32 ms frame in Lares (`core/voice/silero.js`, onnxruntime-web, weights from `@ricky0123/vad-web`); loudness and Router's VAD only when the model cannot load | 0.26.78 |
| When a take ends | 500 ms without a voice; or 1 s after streaming ASR stops finding new words; a take whose voice stays under 250 ms is dropped after 500 ms with `input_audio_buffer.cleared`; 10 s at most | 0.26.78–0.26.81 |
| Barge-in | Speech that stands out from the reply's echo for 500 ms and that Silero hears as a voice; its first ASR words (up to 1.5 s) are compared with what the device is saying (`core/voice/echo.js`); the reply's own words are echo, anything else stops the reply | 0.26.78 |
| ASR load | One ASR request per session (the next take buffers until the previous is read); 503/429 retried after 0.4 s and 1.2 s; a device take ASR cannot read ends with `input_audio_transcription.failed` | 0.26.75 |
| Dialogue | `reasoning_effort: "none"`; device rules send home control, lookups and schedules to `ask_lares`; language follows the latest user message; acknowledgment before the Agent starts, in a few words; one short sentence after a device result | 0.26.70–0.26.79 |
| Diagnostics | One `device-take` voice metric per take (gate, length, how it ended, VAD answer, chunk RMS p50/p95/max); `device-echo` for a barge-in dropped as echo | 0.26.77 |

### What we learned

**Loudness cannot tell a room from a voice.** Reachy sends 10 ms chunks; its room
measured median chunk RMS 0.016, p95 0.022, peaks to 0.05. Every learned energy
floor (1.5x the empty take's average, then 1.2x its p95) still let about one chunk
in twenty through, and a take only ends after 500 ms without a voiced chunk, so
the robot opened a 6–10 s take back to back and held the ASR. A floor tuned to
one room is wrong in the next; Silero scored that room at 0.003 and speech at
1.00, at 0.26 ms a frame on a Mac and about 0.5 s to load in the image.

**A speech model hears every voice.** People talking across the room kept the
"turn on the light" take open for the 10 s limit, and the robot's own reply came
back through its microphone as a person. Both are settled by words, not by
audio: ASR found no new words in the chatter, and an echo says what the reply is
saying.

**ASR busy (503 in 0 ms) is Router's gate, not the engine.** The audio engine
reported `max_concurrency: 1`; model-console copies that onto the model card;
Router admits against it and at width 1 refuses instead of queueing
(`softCap(1) = 1`). Streaming and batch transcription share the slot, and a
stream holds it until its socket closes, so the tail of one take turned the next
take, or a batch fallback, into a 503. Audio Engines v1.1.33 reads
`ENGINE_MAX_CONCURRENCY`; the Qwen3-ASR charts set 3 (terminus-apps #4282,
#4283).

**Capacity and launch flags do not always propagate.** After the ASR engine pod
was replaced, model-console's capacity reporter kept the old reading (it
re-probes on a readiness dip or an in-place relaunch, neither of which happened)
until the app was restarted; Router then kept its own copy until Router was
restarted, because it reads the card when an app turns running. The same shape
hid sglang 1.0.3's thinking-off flag: `ENGINE_ARGS` only seeds model-console's
card on first boot and the card wins after that, so upgraded installs started
with `default_chat_template_kwargs=None`. sglang 1.0.4 sets the flag in its
launch wrapper (terminus-apps #4284). Without it a request with no
`reasoning_effort` spent 3.9 s reasoning and returned nothing inside 400 tokens;
with thinking off it answers in 0.2–0.6 s.

**Prompt changes need the eval, and the eval is noisy.** Measured on the live
model: a filler-word sentence in the device rules (not-done-followup 5/5 -> 1/5),
a language hint on every turn (clarify-answer 9/10 -> 4/10) and the brevity rule
inside the device rules (light-off 2/5) all hurt and were dropped. What held: the
brevity rule in the trailing reminder, the hint only when the language is at
risk, and short cues on the turn that needs them (after a device result:
camera-brief-zh 5/10 -> 10/10, -en 2/10 -> 9/10; after delegating: ack-brief-en
0/5 -> 5/5). The same code scored 4/5 and 1/5 on one scenario in back-to-back
runs, so compare at least five runs in one sitting and judge only the scenarios
whose code path changed.

**Where "turn on the light" spent 24 s** (0.26.78, before the last fixes): 8 s
keeping the take open over background talk, 1.5 s dialogue and acknowledgment,
14 s in the Agent (ten model calls in a row through the generic hass-cli skill,
the first one slowed by the camera turn on the same sglang), then the
announcement queued behind the camera reply. 0.26.79 ends such takes on settled
words; hass-cli 0.0.2 (0.26.81) gives everyday control a two-command path and is
not yet measured on the robot.

**Measured on 0.26.83, the first run end to end** (2026-10-25 05:55, sglang
Qwen3.5-9B with nothing else on it). Times count from the end of the take,
which comes 500 ms after the speaker stops.

| Request | ASR final | Decide to delegate | Acknowledgment | First TTS audio | Device speaks | Agent | Result heard |
| --- | --- | --- | --- | --- | --- | --- | --- |
| turn the light off (first task after restart) | 0.14 s | 0.45 s | 0.13 s (cached) | ~0.25 s (streamed) | ~1.0 s | 6 calls, 6.8 s | ~8.3 s |
| turn it on | 0.2 s | 1.3 s (cache miss) | 0.18 s | ~0.25 s | ~2.0 s | 2 calls, 1.9 s | ~4.4 s |
| make it white | 0.17 s | 0.52 s | 0.13 s | ~0.25 s | ~1.1 s | 3 calls, 3.4 s | ~5 s |

The Agent loaded `ha-lighting` first with no "unknown tool" detour (the 0.0.2
run had three). The first task still took five tool steps because the light's
only name is "Aqara lumi.light.agl003": searches for "卧室" and "灯" found
nothing, so it listed every light before switching it; a Chinese friendly name
in Home Assistant would make it two. Later tasks ran with the skill already in
the session: `service call` alone, or `state get` then `service call`.

sglang prefill per call: the dialogue's ~5k-token prompt hit the cache on the
decision and, since the acknowledgment call keeps the delegating call's tools,
on the acknowledgment too (one decision missed after an announcement changed
the history). The Agent's prompt is now ~13.4k tokens on a new session (35 dsh
tools ~8.5k, system prompt ~2.7k, hass-cli 0.0.3's shorter skill list); its
first call after the restart prefilled all of it (3.4 s), later calls hit
13–15k cached tokens. Before these changes (0.26.82 with the 9B) the same
requests spoke after ~2.3 s and turning the light off took ~8.9 s; at the start
of this work it was ~2.5–3 s and ~24 s with ten Agent calls.

**The camera's colours were lost in its JPEG, not its lens.** Every camera look
came back as "too blurry", "the picture went green" or "green light and blurry
outlines". A frame captured in the robot pod through the app's own path
(daemon -> WebRTC -> `appsrc(BGR) -> videoconvert -> jpegenc`) looked right in
a viewer, but its JPEG was in the RGB colour space: component ids `R`, `G`, `B`
(82, 71, 66), 4:4:4, no JFIF marker, because jpegenc accepts BGR and nothing was
converted. Viewers and PIL honour those ids; the vision model's decoder read the
planes as Y, Cb, Cr, which turns the frame into a bright green field with magenta
streaks where the lights are (reproduced by decoding it that way: 99% of pixels
green-dominant). The same frame re-encoded as YCbCr was described correctly, so
camera, transport and Lares (which forwards `input_image` untouched) were all
fine. reachymini 0.1.8 (beclab/olares-reachymini `afcfe9e`, tag v0.1.8) patches
reachy-mini 1.12.0 at build time to link videoconvert to jpegenc through
`video/x-raw,format=I420`, so stills are YCbCr 4:2:0 and about 114 KB instead of
270-330 KB; after it the robot named the cola bottle in the user's hand. Frames
are still dark in a bright room: auto exposure meters on the monitor and the
ceiling lights in view. Raising contrast to 32 and backlight compensation to 6
made it darker, and the defaults (contrast 1, backlight 2) were restored.

### Where a device turn spends its time, compared with LiveKit Agents (2026-10-25)

Measured on pptest03 with sglang Qwen3.5-9B and nothing else using the GPU,
for "turn off the light" (Lares 0.26.82; from the moment the user stops
speaking):

| Stage | Time | Running total |
| --- | --- | --- |
| Silence until the take ends | 0.5 s | 0.5 s |
| ASR final result (streaming) | 0.16 s | 0.7 s |
| Dialogue decides to delegate (5.1k-token prompt, cached) | 0.48 s | 1.2 s |
| Dialogue words the acknowledgment (missed the cache until 0.26.83) | 0.94 s | 2.1 s |
| TTS of the whole sentence (streamed from 0.26.83, first audio about 0.24 s) | 0.64 s | 2.8 s |
| Agent, two model calls (first prefilled about 17.9k tokens from scratch, about 3 s) | 4.8 s | |
| Result wording 1.1 s, its TTS 1.2 s | | about 8.9 s to the result |

A chat turn skips the acknowledgment call. sglang's `Prefill batch` log lines
(`#new-token`, `#cached-token`) show each call's prefill and cache use; the
robot-side capture and playback latency is not measured.

The same stretch in LiveKit Agents (Python `livekit-agents` at `ab7fe5b46`;
agents-js has the same defaults), stage by stage:

| Stage | LiveKit Agents | Lares device sessions |
| --- | --- | --- |
| End of turn | Silero plus a text end-of-turn model: waits `min_delay` 0.3 s when the model says the turn is complete, up to `max_delay` 2.5 s when not (0.5/3.0 s without the model); `dynamic` mode learns the user's pauses (`voice/turn.py`, `voice/audio_recognition.py`) | Fixed 500 ms of silence, or 1 s after ASR stops finding new words |
| Preemptive generation | On by default: the LLM starts on each changed STT final transcript, before the end-of-turn delay; reused at commit only if transcript, chat context, tools and tool choice are unchanged; TTS and tools wait for the commit | None: the dialogue starts after the take commits |
| LLM to TTS | Token stream into a sentence tokenizer (blingfire, `min_sentence_len` 20); the next segment's TTS starts while the previous one plays | Whole reply first, then sentence by sentence; device TTS streams from 0.26.83. With read-while-writing on a MemorySlice card, closed sentences are spoken while the dialogue writes (see item 6) |
| Interruption | 0.5 s of speech pauses playback; with no words within `false_interruption_timeout` 2 s it resumes; interruptions ignored during `aec_warmup_duration` 3 s after the agent starts speaking; echo is left to AEC, transcripts are not compared | Speech that clears the reply's echo for 500 ms and that Silero hears as a voice, then up to 1.5 s for ASR words, compared with the reply; only then playback stops |
| Tools | The voice LLM speaks and calls tools in one reply; tool results trigger a follow-up (`max_tool_steps` 3); optional `with_filler` and a `BackgroundAudioPlayer` thinking sound; `say(audio=...)` plays pre-synthesized audio | A separate acknowledgment call, then the dsh Agent (its own LLM and an about 18k-token prompt) |
| Latency metrics | Per turn: `end_of_turn_delay`, `transcription_delay`, LLM `ttft`, TTS `ttfb`, `playback_latency`, `e2e_latency` | `device-take` only (take length, ending, levels) |
| Warm-up | VAD, LLM and TTS connections prewarmed at session start | Silero loaded at session open (about 0.5 s) |

Improvements, in order of value for effort (none implemented yet):

1. **Per-turn latency metrics.** Record, per turn, end of speech, take commit,
   ASR final, dialogue first token, first TTS audio and first audio sent, and
   the end-to-end delay, after LiveKit's `MetricsReport`. Every change below is
   judged by it.
2. **Preemptive generation** (about 0.3–0.5 s every turn). Start the dialogue on
   the streaming ASR text as soon as Silero hears silence; at commit reuse it if
   the final text is unchanged, otherwise discard and restart. As in LiveKit,
   nothing is synthesized and no tool (`ask_lares` or a device tool) runs before
   the commit.
3. **End of turn by completeness** (about 0.2 s on average, fewer cut
   sentences). Cheap form: Qwen3-ASR's partials carry punctuation, so a take
   whose text ends in 。？！ commits after 300 ms and one that does not waits up
   to about 1 s. Full form: LiveKit's multilingual end-of-turn model (v1-mini,
   Chinese included).
4. **Thinking feedback** (largest perceived gain). When a take commits, the
   device plays a short gesture or sound, like LiveKit's thinking sound.
5. **Fixed acknowledgments with cached audio** (about 1 s on delegation). Pick a
   short phrase per language instead of an LLM call, from pre-synthesized audio
   (`say(audio=...)` in LiveKit).
6. **Stream the dialogue's text into TTS** instead of waiting for the whole
   reply; worth more as replies get longer. Implemented for device sessions
   behind the existing read-while-writing setting (`streamingEnabled()`: saved
   `streaming` and a MemorySlice card); on TimeSlice a device stays serial.
   Measured on pptest03 (RTX 5090 Laptop, TimeSlice, 2026-10-25): TTS
   overlapping decode cut Qwen3.6-35B-A3B from 159 to 15-20 tok/s, so time
   slicing must not overlap them, while a 23-token median device reply takes
   0.15-0.5 s to write anyway. The first sentence waits for the second or for
   the chat call to end, and a call that starts `ask_lares` releases nothing
   more, so words written before a delegation are not read; device calls follow
   the first words instead of preceding them. Not yet tried on the robot.
7. **Interruption.** Turn on the ReSpeaker's echo cancellation with the playback
   reference, which is what LiveKit relies on and would let the 1.5 s word
   check shrink; ignore interruptions for the first seconds of a reply, as
   LiveKit's AEC warm-up does. Pausing and resuming playback is not possible
   over the OpenAI Realtime protocol Reachy speaks.
8. **One model for everyday home control** (about 4–5 s on "turn on the
   light"). LiveKit's voice LLM calls tools itself; Lares's dialogue hands even a
   light switch to the dsh Agent, whose first call alone costs about 3 s of
   prefill. Giving the dialogue a direct home-control tool trades the Agent's
   generality for speed and is a product decision. Short of that, keep the
   Agent's prompt prefix identical across tasks (anything that changes per task
   at the end) and smaller than its current 17.9k tokens.

### Routing a device turn: three options measured (2026-10-25)

The device dialogue decided between speaking and acting in free text, and
keyword checks caught a model that said an action instead of doing it
("能把它变成白色吗？" answered "将灯光调整为白色中。" with no ask_lares, so the
light stayed yellow). Every new phrasing was a new gap, so three structural
options were measured with `scripts/voice-eval/route-probe.mjs`: 26 utterances
from field tests (follow-ups such as "调亮一点" and "Make it warmer" after a
light turn included), each sent three times as the dialogue's own first request
to Qwen3.5-9B (sglang, memory slicing).

| Option | Correct route | Time per call | Notes |
|---|---|---|---|
| Today: tool_choice auto, before the keyword checks | 72/78 | median 353 ms | 5 of 6 misses are a home or device request answered in words |
| A: every reply is a tool call (`speak` added), tool_choice `required` | 12/78 | about 9.8 s | the model keeps emitting tool calls until max_tokens; `parallel_tool_calls: false` reaches sglang and changes nothing (15/78) |
| B: a forced `route` call (lares / camera / motion / speak), then the turn | 75/78 | median 302 ms, p90 316 ms | one of three "Turn off the lights please" routed to speak, which is the failure being removed |
| C: B without `speak`: everything but the camera and motion goes to Lares | 77/78 | the route call, then the Agent | small talk waits for the Agent: first text 0.2–2.4 s after hand-off, median about 1.6 s |

A is not usable until the engine stops a `required` call after one tool. B
keeps small talk at about 1 s and makes a misroute either slower (sent to
Lares) or, for a narrow speak route, rare. C cannot claim an action it did not
take, because only the Agent can act and the dialogue no longer speaks for it;
it costs small-talk latency and needs the device persona in the Agent's prompt.
C shipped in 0.26.99/0.26.100 (the Agent's first sentence spoken while it
wrote, its answer when the task ended, the device persona in its prompt) and
was worse on the robot: "你好" came back as "我是 Lares" (the Agent's own
identity outweighed the persona), a fresh Agent session given only the raw
"把灯打开，然后调整成绿色" asked which light instead of listing them, and
"我只有一盏灯" was answered "调成绿色了" with no tool call, a raw entity id and
unasked advice. 0.26.101 ships B instead: the route call fixes the turn's tool
choice (lares must call ask_lares, so the dialogue still writes the task from
context; speak may call nothing; camera must call the camera), and
acknowledgements and announcements stay with the dialogue.

On the robot B routed every turn correctly, but the Agent then answered "好的，
我来帮你把灯打开并调成绿色。" in one 13-token step with no tool call, and the
same for the light off, although its prompt, tools, model and parameters
matched earlier sessions that acted at once. The failure began after 15:00 UTC,
when the probes and then every B turn sent forced (grammar-constrained) tool
calls to the same sglang; the 0.26.98 code (repackaged as 0.26.102, a downgrade
being refused) in a new Agent session after an sglang restart switched lights
again. Whether constrained requests disturb other requests on sglang is not
confirmed: replay a captured Agent request alone and beside forced tool calls
before routing with tool_choice again. Every change after 0.26.98 was reverted;
these notes and the probe remain.

### Working on it

- Eval: `node scripts/voice-eval/run.mjs --runs 5 [--only a,b] [--model <id>] [--dialogue ../../packages/core/voice/dialogue.next.js] [--json out.json]`
  inside the Lares pod, so Router sees the same identity. It replays a device's
  real flow, including the step after a device tool result and gesture-only
  steps. From a workstation, `scripts/voice-eval/remote.sh <ns/pod> <out-dir>
  base next=<dialogue.js copy> -- --runs 5 --model <id>` uploads the eval and
  each working copy, runs the passes one after another in the pod and prints
  `compare.mjs`'s table. Pass an explicit `--model`: `default-chat` follows
  whichever model Router serves at the moment, and models differ — on
  2026-10-25, Qwen3.6-35B-A3B passed 104 and Qwen3.5-9B 94 of the same 110 runs
  with the same prompt. A 5-run pass moves by one or two runs between repeats;
  compare candidates in the same invocation.
- Regression: `scripts/voice-eval/regress.sh <model-id> ...` runs this checkout's
  `dialogue.js` against `scripts/voice-eval/baselines/<model>.json` and exits 1
  when a scenario's pass rate fell by 40 points (two of five runs), a scenario
  disappeared, or the scenarios both ran lost more than three runs per hundred.
  The same dialogue differs by up to three of five runs on one scenario, so a
  flagged scenario is run again ten times and only a 30-point drop there counts.
  Changes outside `dialogue.js` (the realtime gateway, the Agent prompt) are not
  covered: they need a release and a field test. Run it before every
  dialogue change ships, on each model a device may meet (today Qwen3.5-9B on a
  memory-sliced card and Qwen3.6-35B-A3B on a time-sliced one: they fail
  different scenarios), and refresh the baseline with `--update` after a
  release. A new robot failure becomes a scenario first — `prelude` turns replay
  earlier turns with real camera calls and frames — and is fixed second.
- Field tests: `scripts/voice-eval/field/collect.sh <dir>` follows the robot's,
  Lares's and Router's logs while someone talks to the robot;
  `field/analyze.sh <dir> <from> [<to>]` prints one row per turn (path taken,
  time to first audio, dialogue calls and whether the Agent was running, task
  result, flags such as a home request not delegated). Keep the GPU mode and
  serving model of each round next to its table: a time-sliced 35B and a
  memory-sliced 9B differ by about 4x in time to first audio (4.9 s vs 1.2 s
  median on 2026-10-25) and in which mistakes they make.
- Test builds: `docker buildx build --builder desktop-linux --platform linux/amd64,linux/arm64`
  (the QEMU builder crashed esbuild), `scripts/package-chart.sh`, then
  `olares-cli market upload` and `market upgrade lares -s upload`. An app
  installed from `market.test` cannot be upgraded from `upload` (HTTP 404); merge
  its terminus-apps PR and upgrade from `market.test` once it lists the version
  (about six minutes).
- Logs: the robot's `reachymini` container (`role=user|assistant`, `Tool call
  received`), Lares `[lares:voice]` metrics, and Router `http_request` lines
  (latency and status per `/v1/audio/*` and `/v1/chat/completions` call).

### Open

- The Agent's first call misses sglang's cache when a task follows the previous
  one by a minute or more (tasks 17 s apart hit 17.9k tokens); whether a
  refreshed time or runtime snapshot or eviction by other requests on the
  hybrid model breaks it is not confirmed. Capture two such requests to diff.
- Every voice task still carries all 35 dsh tools (~8.5k tokens); a voice preset
  with about ten would cut the Agent prompt roughly in half.
- The eval's overall pass rate fell from about 91% to 80–85% after sglang 1.0.4;
  not investigated.
- Camera frames are dark when bright lights or a monitor are in view (auto
  exposure); a device that only says it will look ("Let me take a look") without
  calling the camera was seen once, in English after a restart.
- model-console does not re-probe capacity when the engine pod is replaced, and
  Router does not re-read a card that changes after the app turned running.
- Router: the default-realtime category was repointed to
  `lares-reachy/voice-assistant` automatically; Router's docs describe an
  openai-compatible provider while its Realtime path requires type `openai`.
- `olares-reachymini` 0.1.8 is released from main (tag v0.1.8, images built by
  its publish workflow). Its pod adds group 0 to `supplementalGroups` to reach
  the ReSpeaker's USB nodes; a device-specific group would be narrower.
- PR 67 contains `f74b4bf`, the source half of the hands-free short-take fix,
  pushed by another session under a "publish Lares 0.26.79" message; `b9e431d`
  carries its tests and explanation.

## Voice finish and settings RPC closeout (2026-10-19)

The shared panel synchronizes confirmed read-aloud preferences once per active
conversation/value. Startup waits for the VoiceSession to exist; concurrent
changes are ordered, old sessions cannot publish synchronization errors into a
new session, and failed synchronization exposes retry while remaining muted.
Disabling stops local output immediately; enabling does not replay the current
answer or history. Neither operation cancels the Agent. New configurations still
default to read-aloud off; explicit saved preferences remain authoritative.

The official PC inline indicator disappears on pause, end, close and idle release,
including its layout space. Automatic multi-turn listening stays visible. Compact
errors have recovery actions; elapsed-time ticks run only for active dictation.
Vue and PC share the same panel and conversation implementation.

The Vue Enter preference now matches the installed dsh descriptors:
`settings/describe` sends `args: {}`; `settings/update` sends named `ns`, `patch`
and optional `expectedRevision` directly in `args`, without a `request` wrapper.
Read-only and revision-conflict errors remain visible and preserve the previous
preference. Real local Host read/write/reload/restore passed. Test fixtures now
reject the former malformed wire shape. The prior macOS file-preview failure was
owned temporary symlink cleanup, fixed by unlinking the link itself.

See [the session handoff](voice-handoff.md) for current commits, local validation,
remaining physical-device gates and the unresolved historical 400. The accepted
natural Chinese segmentation remains unchanged by this closeout.


## Shared assistant speech cleanup (local, 2026-10-18)

Both buffered `speakFromConfig` and the PCM WebSocket gateway call the same core
`speechSegments` cleaner. PC and both Vue device modes inherit it without UI
copies. The [design rules](voice-service-design.md#shared-assistant-speech-text)
define Markdown, emoji and table treatment. The zodiac regression preserves all
twelve animal names and their order, removes emoji, and retains the existing
one-line-per-item segmentation. Emoji-only output completes without TTS calls.
Raw `/llm/v1/audio/speech` input remains unchanged, including explicit audition.

`voice-spoken-text.test.ts` checks every UTF-16 prefix of representative streamed
answers, including split emoji sequences and incomplete Markdown, for stable
segment prefixes. It also intercepts final HTTP synthesis bodies through the
actual buffered service and WebSocket gateway; testing only a cleanup helper is
insufficient. Existing player cancellation/session tests remain required.

Acceptance must record PC, Vue mobile at 390px and Vue desktop chat/read-aloud and
settings smoke separately, with build identity. Request-body checks and receipt of
audio are not subjective listening acceptance. Physical phones, Bluetooth and
human pronunciation confirmation must be recorded separately. No changes to
read-aloud defaults, models, voices or remote engine/GPU settings are required.

Local acceptance used the full dsh page and real Vue source components against
an isolated Host and the existing authorized LAN Router. The shared resource
build was `2633d3a-ba4876fbc232-13c19eb84387-4b0f5a04c43b` (working tree changes;
the private acceptance record also hashes the exact Host cleaner source).

| Surface | Viewport | Result |
| --- | --- | --- |
| Official dsh PC | 1280×720 | Real Qwen reply retains emoji in chat; automatic audio reaches browser rendering; voice settings load |
| Vue desktop | 1280×720 | Real reply and audio rendering pass; speech settings/voices and desktop shortcuts load |
| Vue mobile | 390×844 | Real reply and audio rendering pass; no horizontal overflow; settings/voices load and shortcuts stay hidden |

Desktop Vue still exposes the existing `settings/describe` unexpected `request`
error for Enter behavior. That settings item is not passed. Human listening,
live microphone, physical phone and Bluetooth were not accepted this round.
The shared browser fallback also handles an empty buffered result without
creating an audio player; Host returns `{ sentences: 0 }` rather than encoding
missing audio. Real empty WebSocket output ends without format or PCM frames.

Final short-text LAN checks returned 138284 buffered WAV bytes and 69120
streamed PCM bytes. The latter delivered first audio at 233ms and completed at
468ms, one warm sample rather than a percentile or an LLM end-to-end improvement.
Browser rendering was observed separately for all three surfaces. The isolated
test's saved config was unchanged by HTTP checks; its temporary read-aloud toggle
was restored to off. Normal local service preferences were not overwritten.

Validation: 285 voice tests pass; typecheck and PC/Vue/server/preview builds pass.
Full suite: 831/832, with the existing macOS file-preview temporary-directory
cleanup failure (`ERR_FS_EISDIR`, `file-preview.test.ts:1341`). Evidence includes
`lares-spoken-{tests,voice-tests,full-tests,typecheck,build,preview-build,http}.log`
in the temporary directory, ignored `spoken-acceptance.json`, and screenshots
`lares-spoken-{pc,vue-mobile,vue-desktop}.png` plus Vue settings screenshots.
The additional investigation of LLM-to-TTS streaming is documented in the
[design](voice-service-design.md#llm-text-streaming-and-tts-scheduling): audio
streaming currently starts after a settled dsh reply; an authoritative incremental
reply commitment is still required before enabling earlier narration.

## TTS voice settings and raw dictation default (local, 2026-10-18)

PC and both Vue device modes share a Speech playback section: model, model-bound
voice, explicit Preview/Stop preview, and the independent automatic read-aloud
switch. A preview synthesizes the fixed sample “你好，这是 Lares 的语音试听。”
through the existing authenticated Host `/llm/v1/audio/speech` shim and plays on
the current client. It does not create a session, send an Agent turn, enable
read-aloud, or use the configured host/Bluetooth output device. The sample is a
short WAV; normal reply streaming remains in place.

`ttsVoiceByModel` maps exact model IDs to exact voice IDs; an empty value means
omit `voice` and let the model use its default. Legacy `voice` is considered by
Lares only for its explicitly saved `ttsModel`, without migration writes. Generic
Voice Service explicit voice overrides remain supported. The hidden preferred-
voice picker was removed. Stream grants and buffered readouts bind one model and
voice snapshot; settings changes apply to a new playback, not its remaining
sentences. A removed selected model cannot silently select another model.

Voice lists use the existing `/llm/v1/audio/voices?model=...` shim, preserve names
and IDs, and distinguish missing preset support from auth/network/server failures.
Directory requests time out after ten seconds, and previews after sixty seconds.
No presets permits default audition; an unavailable saved voice is retained and
requires a new choice. Model/voice saves keep the confirmed setting on failure.
Stop, a changed selection, settings exit or new capture/active conversation cancels
preview, releases its audio URL/resources and discards late audio. The shared
panel publishes only changes in activity, not a new UI polling timer.

New/unconfigured dictation defaults to `raw`, including shared panel reset and
processing fallbacks. Explicit saved raw/clean/outline/summary choices, older
explicit cleanup choices, processing profiles and shortcuts remain intact. Raw
bypasses the text-processing LLM, preserving text, attachments and user-send-only
Agent execution.

Acceptance used the real local Host and authorized LAN Router with Qwen3 TTS.
Nine preset voices loaded. Vue mobile saved `serena` and restored it after reload;
PC restored the same choice and saved Model default. Vue audition completed, PC
start/stop restored the button, and read-aloud remained off. Fixed-text HTTP checks
returned valid WAV with model default (1011 ms, 161324 bytes) and serena (1001 ms,
153644 bytes); these are two warm samples, not a P50/P95 latency claim. Synthetic
serena audio passed real ASR, kept the negation, and raw processing preserved the
whole transcript. Configuration before/after those checks was identical.

Final browser matrix: PC 1280×720, Vue desktop 1280×720, Vue mobile 390×844. Settings
and history/composer smoke checks passed; mobile has no horizontal overflow or
shortcut section, desktop shows shortcuts. Vue desktop's existing Enter settings
`settings/describe` unexpected `request` RPC error remains visible and unpassed.
Live microphone-to-draft, subjective listening, physical phones, Bluetooth and
full LarePass binary transport were not manually accepted this round. Multi-model
voice switching/failure cases used automated fixtures because the authorized
live catalog exposes only one TTS model.

Validation: 278 voice tests pass; full suite 824/825, with only the existing macOS
`file-preview.test.ts:1341` temporary symlink cleanup error (`ERR_FS_EISDIR`).
Typecheck, PC/Vue/server builds and standalone Vue preview build pass. Evidence:
`/private/tmp/lares-tts-{tests,full-tests,typecheck,build,preview-build}.log`, the
ignored `tts-settings-acceptance.json`, and screenshots
`lares-tts-{pc,vue-mobile,vue-desktop}.png` in the Codex visualization directory.
No remote release or deployment, model configuration, GPU mode, credentials or
existing read-aloud preference was changed.

## Router output budget truncation (local, 2026-10-18)

The short “你好” / “测试” replies were genuine one-token requests, not a false
UI warning. The dsh request header declared 4096 output tokens, while pi-ai's
second context clamp reserved another fixed 4096 tokens and silently reduced
the final wire budget to 1. The real isolated Agent recorded 13,858 input tokens,
1 output token and `length`. Both OpenAI output-budget field names worked in
small-prompt controls; renaming the field was not the fix.

The Router-only vendor patch now reserves one eighth of the declared context
window, capped at the previous 4096-token headroom, then bounds the requested
output by the remaining space. Other providers retain their existing behavior.
No room produces `CONTEXT_WINDOW_EXCEEDED`, rather than a fabricated one-token
answer budget. This remains a conservative estimate, not authoritative server
tokenization; upstream context rejection must remain visible. It neither expands
the model window nor changes a saved model/reasoning choice.

An initial 5% reserve was insufficient: a real test requested 3115 completion
tokens beside 13,901 input tokens, exceeding the 16,384-token window. The captured
upstream error identified this precisely. After retaining 2048 tokens of headroom
for this model, the same isolated full Agent path sent a budget of 1880 and
completed a two-sentence reply. This identifies this test's 400; it does not prove
the cause of the earlier historical 17:47 error whose body was not retained.

Acceptance used the actual local dsh PC and Vue source preview against a separate
local Host with the existing authorized LAN Router identity, not synthetic chat
responses. PC (1280×720), Vue mobile (390×844), and Vue desktop (1280×720) completed
new test turns with explicit `none`, no output-limit warning, and no tool calls.
Vue settings loaded the saved raw preset; mobile hid shortcuts and desktop showed
them. Desktop still exposes the already-known `settings/describe` unexpected
`request` RPC error; that settings item is not passed. Microphone, playback,
physical phone and Bluetooth were not retested for this output-budget change.

Validation: 10 focused tests, typecheck and PC/Vue/server build passed. Full suite:
812 tests, 811 passed, the existing macOS `file-preview.test.ts:1341` temporary
symlink cleanup failure (`ERR_FS_EISDIR`) remained. The new vendor patch applies
to a fresh package-lock-pinned pi-ai archive and installer replay is idempotent.
Evidence: `/private/tmp/lares-budget-{before,after,tests,full-tests,build}.log`;
local screenshots `lares-output-budget-{pc,vue-mobile,vue-desktop}.png` in the
Codex visualization directory. Captured test request/error bodies stay private in
the ignored local debug directory; no credentials are included in this record.

## Native Router reasoning identifiers (local, 2026-10-18)

Lares now preserves Router's option IDs, order and default metadata. `none` stays
`none` in the catalog, session choice and final request; PC/Vue may translate its
label to “关闭思考” / “No thinking”. Model default is a separate omitted override.
The Router route bypasses pi-ai's fixed effort vocabulary and binds metadata and
payload validation to the prepared capability snapshot; non-Router validation
remains unchanged. No new Host endpoint or parallel model directory was added.

Old Router session `off` choices normalize only when `off` is not declared and
`none` is declared. The existing durable session selection is written before new
input admission; failures retain the old selection and reject new work. Global
model defaults and read-aloud preferences are not migrated or overwritten.
Removed/unsupported options display unavailable and fail admission rather than
silently defaulting. Background refresh cannot replace a prepared request's
capability snapshot.

Fresh isolated-page acceptance exposed a missing SessionController `settings`
injection in the existing catalog-coordination work. The dependency is now
explicit; the clean Host can open its model directory and select a real model.
The vendor patches were replayed in order on clean, package-lock-pinned npm
entrypoints, compared to installed code, and checked for idempotence.

Final local code revision: `10f0749`; build ID:
`10f0749-f106f672762d-c5003f3f2d15-143f2e7f021d`.
The real pre-existing failed session was reopened after restart: its historical
`lastUsed.reasoningEffort` remains `off`, while durable `next.reasoningEffort`
is `none`. The composer displays “关闭思考”. No failed task was resubmitted;
global model/read-aloud preferences matched the pre-restart snapshot exactly.
Temporary acceptance Host/Vue processes were stopped afterwards.

Verification: 56 related surface/model tests passed, followed by the added
restore/installer regressions. Final complete suite: 810/811 passed; the only
failure is the existing macOS file-preview temporary-directory cleanup
(`ERR_FS_EISDIR`). Typecheck and complete PC/Vue/Host builds passed. Clean npm
patch replay passed; installer markers were corrected so later patches do not
make earlier ones reapply. Two consecutive installer runs preserve vendor code.

### Real model and historical 400

Through the existing local Host and same authorized LAN Router identity, the
concrete Qwen3.5-9B model returned 200 for default, `none` and `high`, both HTTP
JSON and SSE. Non-stream reasoning character counts were 634 / 0 / 808; SSE
counts were 154 / 0 / 393. Responses contained actual answer text. This confirms
current short model calls accept `none` and disable generated reasoning, rather
than merely hiding it in the UI. No model-name-based template override was added.

The 17:47:18 failure was correlated with Router usage (`upstream_error`, HTTP
400, 42 ms) and SGLang's 400 access log. Neither retained the rejection reason;
the request log records session `off` and maxTokens 4096, with contextWindow
16384. These fields alone do not establish the cause. The historical 400 is
**not closed** and was not automatically resubmitted. Current controls do not
justify guessing a template or context-budget fix. Model Console code was not
changed because a missing `none` engine translation was not demonstrated.

### Three-surface acceptance

Selection-changing checks used temporary full Host/Vue instances on 18119/18120,
with independent data and preferences; the normal 18117/18118 instance and its
saved global model/read-aloud choices were preserved. These were the real dsh
and Vue components against the real LAN Router, not a simulated chat shell.

| Surface | Actual viewport | Result |
| --- | --- | --- |
| Official dsh PC | 1280×720 | Fresh directory load, concrete model/none selection, model settings and cross-client high refresh passed. Real Agent accepted a request and persisted `none`, but its reply ended at the output limit after “测试”; full reply acceptance failed. |
| Vue mobile chat/settings | 1280×720; chat also 390×844 | Native choices, none/high/default saving and reload, history and actual settings loaded; mobile shortcuts hidden. Same partial Agent result is not a separate successful response. |
| Vue desktop chat/settings | 1280×720 | Native choices, high save/reload, history and settings loaded; desktop shortcuts visible. Existing Enter settings RPC descriptor mismatch remains. |

The actual dsh adapter test intercepts HTTP requests after request construction:
absent override, `none`, `high` and an unknown declared ID survive unchanged;
a catalog change cannot replace a prepared operation's snapshot. Structured 400
body/code and empty-body errors remain visible, with no parameter removal or
adapter retry. Full Agent reply completeness, historical 400 diagnosis and
physical microphone/device testing are not claimed as passed. No push, release,
remote deployment, GPU policy change or global preference change was performed.

## Streaming audio (local implementation, 2026-10-18)

See [Streaming runtime](voice-streaming.md) for protocol and lifecycle details.
Qwen ASR partials now run during browser recording; confirmed replies reach the
browser as PCM through a bounded AudioWorklet queue. Tool-bearing dsh steps still
wait for confirmation before speech. Headset playback retains its existing path.

Three real-model transport samples compared the same synthetic text: complete
WAV first bytes 3609/2889/2627 ms; streamed PCM first samples 241/235/238 ms.
Medians are 2889 ms versus 238 ms; total generation remained 2.7–3.7 s. These are
arrival timings, not audible output or a proven cold/warm benchmark. A separate
new Host path check returned first PCM at 976 ms and completed at 2609 ms; real
streaming ASR emitted partials before completion and finalized 141 ms after the
synthetic recording finished. No audio or credentials were stored.

A real browser AudioWorklet check with synthetic speech preserved the 17-character
transcript and its negation; capture finalization took 2017 ms in that run. The
playback worklet actually rendered audio, but first render took 5782 ms and Host
first-output timing was also approximately 5.8 s. This is not an end-to-end speed
acceptance. A subsequent matched warm comparison found direct PCM first samples
238–291 ms and the new Host path 249–291 ms (one earlier direct short request was
648 ms). Upstream load and Agent generation must be measured per turn before
claiming faster perceived replies. The latest diagnostic logs also contained an
Agent first-text delay of 9821 ms; it was not correlated to the same turn as those
TTS measurements, so the durations must not be added together.

Two correlated synthetic dsh-to-TTS turns measured Agent reply readiness at
2122/1265 ms, followed by TTS first audio after another 6006/5822 ms (total
8128/7087 ms). Read-only engine logs explain the latter turn: LLM acquired the
GPU lock at 16:32:33.294, released it for inactivity at 16:32:38.566, and TTS
acquired it at 16:32:39.293, after accepting the HTTP request at 16:32:33.727.
This is a GPU scheduling handoff delay, not whole-file browser buffering.
The local HAMi client checks inactivity on a timed interval before announcing
release; changing that shared scheduling contract is outside this rollout.
No GPU policy, remote engine, model or deployed proxy was changed. Streaming
reduces synthesis buffering but does not remove this observed handoff wait.

An initial manual PC attempt failed: the capture worklet continued sending after
ASR finish. The fix flushes/disconnects capture first and makes cleanup idempotent;
a dedicated browser-lifecycle regression and the real synthetic browser check pass. The real-microphone retry,
audible first-sample timing, Bluetooth and physical mobile acceptance remain
pending; the earlier transport success must not be counted as their acceptance.


## Single dictation selector (local, 2026-10-17)

React and Vue now show a single Dictation style selector (raw, clean, outline, summary), followed directly by the selected profile's expanded configuration. The four-row list, Set default/Edit actions, Editing heading and independent editor state are removed. Raw shows only its no-LLM explanation; other profiles show their model and six-line instruction editor. Initial opening uses the saved choice without changing it.

Selection and default are the same confirmed `dictationPreset`. The shared preference guard saves changes before replacing the editor, prevents competing switches, and leaves the original selection on a failed write. Dirty model/instruction edits require Save, Discard or Keep editing before switching or leaving. Failed profile saves keep the question open; Keep editing preserves the original style and draft. Reset changes only the draft, Save/Cancel appear only for dirty profiles, and each profile's saved configuration remains independent. No API, configuration migration, recording or task-path changes are included. Shortcut visibility and recording behavior are unchanged.

Verification: 274 related tests pass; typecheck and complete web/Vue/Host builds pass. Full suite: 777/778, with only the existing `tests/plugins/file-preview.test.ts:1341` temporary-link cleanup failure (`ERR_FS_EISDIR`). Unit tests cover guarded continuation/discard/save failure/retry, selection failure, duplicate/pending switches, independent profiles and refresh. Actual Vue SFC rendering verifies one selector, expanded configuration and raw no-LLM controls.

The complete official local dsh page connected to the real LAN Router passed automatic raw-to-clean switching, direct configuration expansion, unsaved-switch confirmation, Keep editing and Discard. The actual Vue AgentSettings component against the same Host passed raw-to-outline switching, draft protection and the same cancellation/discard behavior; mobile hides shortcuts and explicit desktop shows them. Temporary defaults/drafts were restored to the original raw selection without saving test instructions. The Vue desktop Enter-behavior RPC issue recorded below remains unrelated and unresolved. Exact 390px layout, full packaged LarePass and physical microphones/Bluetooth were not revalidated. No push, version change, release or deployment is included.

## Earlier Lares entry policy and preset list (settings layout superseded above)

Lares no longer selects product behavior from the global Voice Service preset/backend. Shared `voice/lares-policy` fixes dictation to `dictation/pipeline` and conversation to `direct/pipeline` for each connection, including reopen. Global API defaults are preserved. Direct speech submits to the current dsh session without creating an independent dialogue or running voice-chat/summary LLM calls; queue/steer, task tracking, approvals and read-aloud ownership remain in the existing path. Availability uses ASR/TTS plus the actual current Agent directory's routable state. The unrelated voice-chat model does not gate the Lares conversation button.

`POST /api/lares/voice/session` accepts an optional validated `backend` override alongside `preset`. An explicit `realtime` override must use an already validated model; omitted overrides retain the existing API defaults and gates. React/Vue settings remove preset, independent chat model, backend and Realtime model controls. The generic API retains them. Settings changes do not rewrite those saved fields.

Four dictation rows remain visible, with a default marker and separate Set default/Edit actions. One editor is shown, initially for the default; switching editors retains independent drafts and unsaved markers. Raw hides LLM controls. Non-raw profiles have model selection, six-line instructions, draft-only Reset, Save/Cancel and recoverable save errors. Changing defaults or leaving uses the shared Save/Discard/Keep editing guard. The official web shell binds it; LarePass hosts must bind `bindBeforeLeave(listener)` or await the exported settings component's `beforeLeave()` before navigating. Browser unload retains the standard warning.

Shortcut settings are expanded on web and only on explicitly desktop Vue hosts (`device="desktop"`), never inferred from width. Recorder behavior is shared, and recording yields no global voice shortcut or pause action. The Vue SDK uses configuration/capabilities reads and immediately applies confirmed save responses without GPU/install diagnostics. Existing callers retain diagnostic loading by default.

Verification: 273 related tests pass; typecheck and web/Vue/Host builds pass. The full suite passes 776/777, with only the existing macOS file-preview temporary-link cleanup failure at `tests/plugins/file-preview.test.ts:1341` (`ERR_FS_EISDIR`). Tests cover all eight configured preset/backend combinations, direct dsh queue/steer and deduplication with zero dialogue/summary calls, connection reopen, independent draft/default selection, save failure/retry/discard, actual Vue SFC rendering and explicit desktop shortcut visibility.

The complete official local dsh page was rebuilt and connected to the real Router over LAN with verified TLS. With the saved API preset still `dictation`, both Lares entries appear. Real-page checks passed editor/default separation, draft retention across editing switches, unsaved-default guard and cancellation without changing saved preferences. Actual exported Vue AgentSettings was additionally mounted in an ignored component preview against that same Host: mobile hides shortcuts, desktop shows them, raw hides LLM configuration and Esc cancels recording with focus retained. This preview is not the full packaged LarePass app. Its pre-existing desktop Enter-behavior field reports `settings/describe` descriptor mismatch (`unexpected "request"`); that unrelated RPC issue remains open. Exact 390px visuals remain unverified because the browser viewport override still reports 1280px. Human microphone/playback, real iOS/Android and Bluetooth acceptance were not repeated. No push, release, version change or deployment is included.

## Earlier voice preferences simplification (superseded above)

The web settings page now groups dictation, conversation and collapsed keyboard shortcuts. ASR/language precede the default dictation style. The default preset's model and six-line instruction editor appear directly; other presets live in separate disclosures. Raw transcription has no LLM controls. Profile model/instructions remain local drafts until Save, Reset only edits the draft, Cancel discards it, and refresh/disclosure changes preserve unsaved edits. A save failure retains the draft with an inline error. Serialized configuration writes merge profiles and shortcuts against the latest confirmed configuration, preserving other rows and existing playback strategy.

Shortcut bindings are explicit buttons displaying Not set or platform-formatted keys. One recorder owns key capture; a valid main-key release saves, modifiers alone/repeats/IME do not. Esc cancels, Tab cancels and moves focus, blur cancels, and Clear is a separate labelled action. Invalid, reserved, duplicate and failed-save feedback belongs to its row. Failed writes retain the previous binding and offer retry. Only a pending row is disabled; focus returns to its binding after save/clear if no other control has taken it. The document-level voice handler yields to shortcut-recorder events before handling Escape or dictation shortcuts.

The official dsh settings shell receives a minimal `bindBeforeLeave(listener)` owner extension via the replayable vendor patch. Close, mask/Esc and section navigation await its boolean/promise result, with one pending leave operation. Voice settings offers Save, Discard changes and Keep editing for unsaved profile drafts; failed saves keep the page open. Browser tab unload uses the browser's standard unsaved-change warning. Existing sections without a guard retain normal navigation.

GPU/application cards, memory allocation, runtime-mode switching, install/start/stop/probe controls and their web polling have been removed. Opening, refreshing and catalog revision handling use only configuration and the lightweight capability endpoint. Router remains the model-management entry; host GPU APIs and shared implementations remain available to other clients. Existing configuration, streaming strategy and mobile hold-to-speak behavior are preserved. No Host API or configuration migration is added.

Verification: 257 voice/mobile-layout/settings/browser-import tests pass, including twelve new preference/shortcut/shell cases. Typecheck and complete web/Vue/Host builds pass. The full suite passes 762/763; the known macOS file-preview temporary-link cleanup still fails with `ERR_FS_EISDIR`. The local complete official dsh page connected to the real LAN Router passed preset save/reopen/restore without changing the default, close/section-change confirmation, Keep editing, shortcut record/save/clear/Esc, and keyboard-focus restoration. Temporary verification settings were restored. Desktop screenshots verify long model truncation and the instruction editor. The available browser accepted a 390px viewport request but still reported 1280px, including in a fresh tab; exact 390px visual acceptance remains pending, and no actual phone or Bluetooth acceptance is claimed. No push, release or deployment is included.

## Microphone startup latency (local, 2026-10-17)

The PC composer immediately renders a disabled microphone while capability discovery is pending. A confirmed ASR catalog enables it; a confirmed empty catalog hides it. Discovery failures retain the last successful capability snapshot and expose a recoverable error. The authenticated `GET /api/lares/voice/capabilities` route reads the existing Router catalog cache/boot seed and returns model capabilities and selections, without installation or GPU diagnostics. Normal mounts reuse cached discovery; catalog revision events and explicit refresh invalidate it.

`loadVoiceSettings({ diagnostics: false })` loads configuration and capabilities only. Its default still includes runtime diagnostics for existing callers, with separate diagnostic caching and `diagnosticsError`. Settings first renders the lightweight result, then loads diagnostics; unknown/failed diagnostics do not imply an absent installation. Saving applies the configuration returned by Host immediately. A revision guard prevents an older in-flight configuration read from replacing a successful save.

Dictation clicks use a cloned, confirmed configuration snapshot instead of two serial forced refreshes. The optional `prepareInput` panel port requests browser media in the click handler, before queued initialization and remote playback-stop. Its single-consumption resource transfers the same stream to the recorder; host/Bluetooth capture does not invoke browser permission. Formal recording still waits for playback coordination. Preparation shows a cancellable opening state; elapsed recording time and the recording limit begin only once the recorder is ready. Cancellation, background/offline pause, session changes, unsupported recording and initialization failures release unused/late streams. Disposal during asynchronous meter initialization also closes the late meter. Returning from dictation focuses the real composer element; the dsh `InputActions` face does not provide `focus()`.

Browser Performance measures named `lares.voice.startup.*` and debug events contain only stage/duration: entrance, capabilities, permission-request, permission, feedback and ready. Permission-request/feedback measure application startup; permission includes browser/system waiting time. No transcript, audio or credential is included. These measurements are diagnostics, not an acoustic-device acceptance claim.

Verification: 244 voice/mobile-layout/settings tests pass, including a real local HTTP Host test for capability discovery and catalog reuse. Twelve startup tests cover blocked diagnostic/remote-stop requests, snapshot saves, denied/late permission, duplicate clicks, cancellation/session changes, single-stream ownership and cleanup. Typecheck and web/Vue/Host builds pass. The full suite passes 750/751; the existing macOS file-preview temporary-link cleanup still fails with `ERR_FS_EISDIR` at `tests/plugins/file-preview.test.ts:1341`.

The local full official dsh page was rebuilt against the real LAN Router with TLS verification. A warm capability request returned 200 in approximately 2.5ms. Browser inspection confirmed the initial disabled placeholder, opening state with cancel, and restoration of the microphone and editor focus after cancellation. Exact browser mount/click-to-paint <100ms thresholds, system permission dialog timing and a new human-speech round trip remain pending human acceptance; synchronous permission initiation and non-blocking remote initialization are covered by tests. No new phone/Bluetooth acceptance is claimed. Dictation-only conversation-entry gating is intentionally a separate issue. No push, version change or deployment is included.

## PC composer revision (local, 2026-10-17)

PC preserves the editor state, with compact model/effort, a dedicated ASR-gated microphone and a dynamic send/stop/conversation/pause/resume action. During dictation only voice controls are visible: the mounted editor, attachments and ordinary toolbar are temporarily hidden. Completion appends to the original-session draft without sending or opening a preview and restores the ordinary composer; cancellation restores its existing state. Failures retain raw text with retry/use-original on the voice surface. Conversation keeps the editor visible, using automatic VAD rounds and a small status orb; text sends await audio pause and leave voice paused. Background, offline, Esc and session changes stop audio; tasks continue and resume is explicit. Mobile hold/release and dictation preview are unchanged.

Installed 0.26.50 acceptance also exposed a cleanup-route contract error: `/dictation/clean` called the audio-session scope resolver although text processing clients do not send `x-lares-voice-id`. The corrected route uses the authenticated request's Router user identity directly, without allocating an audio session. Model calls retain that user; audio/session endpoints retain their connection-ID validation. A real HTTP regression covers non-raw transformation, raw zero-model bypass and unchanged session-ID rejection. This correction and exclusive dictation presentation are local changes pending publication/deployment.

Verification of these corrections: 230 voice/mobile-layout tests, typecheck and complete builds pass. The full suite passes 738/739, with the same existing macOS file-preview cleanup failure. Desktop/390px synthetic-audio checks confirm that only voice controls remain during recording/recognition/recovery, restoration preserves the draft without sending, and cancellation returns focus to the editor. A real Router `default-chat` cleanup call on yaotest004 returned the expected sentence preserving the time and negation; this is separate from end-to-end acceptance through the corrected, not-yet-deployed Host route.

The shared panel adds optional `manualTurns` and `inlineDictation` constructor policies without changing mobile defaults. The dsh vendor patches add `conversation.input.primary` (chain, native fallback), `inputActions.bindBeforeSubmit(listener)` (returns an unsubscribe function) and compact model presentation. Both click and keyboard sends pass through the native submission guard; no native button is hidden/replaced through CSS.

ASR discovery controls dictation visibility; the pipeline conversation entry additionally requires dialogue and TTS models. Router's `default-chat` alias is accepted when chat models are discoverable. Config loading exposes no unverified voice action; temporary discovery errors preserve last-known capability with recovery. Native Realtime automatic turns and unvalidated barge-in remain unavailable.

Verification below for earlier releases is historical; it does not certify this local revision. No version bump, push or deployment is part of this delivery.

Local verification: 226 voice/mobile-layout tests pass; typecheck and client/mobile/server builds pass. The full suite passes 734/735; the only failure remains `file-preview.test.ts:1341` temporary symlink cleanup (`ERR_FS_EISDIR`). Removed three obsolete desktop floating-position tests with the replaced positioning module; added eleven PC lifecycle, capability, native-submit and real dsh slot-contract tests.

Browser checks used actual React components with simulated audio/Agent ports: idle, recording, recognition, playback, direct draft append (no send), text-send pause, explicit resume and ASR removal. A separate local Lares Host with a mock Router verified the real official dsh composer, native send/stop, compact model label/full tooltip, microphone-before-primary order and entries on a blank session. This caught and fixed the required chain `select` registration. A 390×844 Vue check retained Hold to speak and restored its original draft on keyboard return. Screenshots are local verification artifacts. These checks do not certify microphone capture, inference, acoustic echo, actual phones or deployed yaotest004 behavior for this revision.

Architecture and lifecycle contracts: [Voice service design](voice-service-design.md). Delivery/acceptance status: [implementation plan](voice-service-plan.md).

## Implemented behavior

- Web defaults to dictation; mobile defaults to continuous conversation. `mode` and `mobileMode` are independent. Each client offers explicit mode selection.
- Dictation manually finishes or cancels, optionally cleans punctuation/fillers through Router, and inserts editable text. It does not open or submit a dsh task. Draft text and attachments survive asynchronous insertion; cancellation invalidates pending recognition/cleanup.
- Continuous conversations support `chat`, `assistant` and `direct` presets. The `dictation` preset supports successive transcript insertions without an Agent. Native Realtime supports assistant/chat only and stays behind its real-model gate.
- Assistant mode uses Router Chat Completions for conversational turns and delegates business work through a controlled `ask_lares`. Direct mode submits each turn to dsh. Existing presets/skills/tools remain owned by dsh.
- Read-aloud is independent of input mode. Per-connection mute does not alter the saved global setting; unmute does not replay the muted answer. Stop speaking, pause input, close voice and cancel a business task have separate semantics.
- Microphone level and elapsed recording time are shown when the browser exposes levels. No synthetic waveform is used for host devices without a meter. The voice entry switches the composer to inline capture; conversation uses hold-to-speak/release-to-submit. Only dictation editing opens a preview panel.
- Background/visibility loss pauses capture/playback. Resumption is explicit. Default idle resource timeout is 300 seconds; default recovery grace is 120 seconds. Silence-only input does not keep a conversation alive forever.

The shared `voice/controller` owns connection, input, Agent and playback states. `voice/conversation` supplies pipeline adapters; `voice/realtime-conversation` supplies native PCM/Realtime adapters. `voice/host-service` is the server-side service boundary. Host files only mount routes/adapters.

## Binding and recovery

`x-lares-voice-id` identifies a connection, not a credential. Host scopes are also partitioned by the authenticated owner. `x-lares-voice-device` selects browser/device or host audio. Different clients may explicitly bind the same business session while retaining independent input/output and request ownership.

Existing-chat entry binds its session. Standalone business delegation creates lazily, with the server's Agent preset/workspace. Voice close never cancels durable tasks. Mobile follows a lazily created task without interpreting that adoption as a user-requested session switch.

dsh `turn/start` precedes claimed user messages; `user/message.source.rpcId` identifies their requests. Replies and completion carry turn numbers. The adapter tracks each request/turn, including multiple steer messages in one turn, and ignores foreign turns for speech. Acceptance is not completion. Unknown submissions remain deduplicated; recovery follows the original task rather than sending it again.

Records live under `$DSH_HOME/voice-records`, partitioned by hashed owner/context paths. Files contain allowlisted text records, task associations, versions and recovery context; no raw audio or model credentials. Writes are synchronous atomic transactions within this single Host process, not a multi-replica storage protocol. Files have mode 0600.

Pipeline conversation turns checkpoint a Router-generated recovery summary; recent text remains available if summarization fails, with `summaryError` in session state. Native recovery consumes available transcript events and saved context; the real-model gate must remain closed until that model's transcript/restore behavior passes acceptance. Records are inspectable and clearable, and removed with their parent dsh session. Clearing records ends that voice runtime before deleting its memory.

Independent callers can explicitly resume their own `contextId`; there is no automatic cross-user or implicit old-context selection. The same opaque context value under another owner cannot read those records. Bound context handles preserve business bindings; parent deletion removes those handles too.

## Settings and internal endpoints

Voice settings are stored in `$DSH_HOME/voice-input/config.json`.

| Setting | Default / meaning |
| --- | --- |
| `mode`, `mobileMode` | `single`, `continuous` |
| `preset` | `assistant`; also `dictation`, `chat`, `direct` |
| `backend` | `pipeline`; optional validated `realtime` |
| `model`, `ttsModel`, `realtimeModel` | Router model IDs |
| `chatModel` | `default-chat` |
| `dictationCleanup` | false; faithful cleanup, never task execution |
| `instructions`, `voice`, `language` | Speech instructions, explicit voice and recognition language |
| `endpointSilenceMs` | 500; allowed range 200–3000 |
| `idleTimeoutMs`, `recoveryTimeoutMs` | 300000, 120000; range 10000–3600000 |
| `speak`, `streaming` | false; saved read-aloud preference and sentence streaming |

Authenticated routes remain under `/api/lares/voice`:

| Endpoint | Purpose |
| --- | --- |
| `POST /session` | Create runtime; bind optional session / owner-scoped context |
| `GET /session` | Conversation state, individual tasks and reply revision |
| `POST /session/prompt` | Stable request ID and queue/steer submission |
| `POST /session/resume` | Refresh task observer without resubmission |
| `POST /session/output` | Change this connection's read-aloud flag |
| `POST /session/cancel` | Explicit dsh cancellation |
| `POST /session/close` | Release voice, preserve tasks |
| `POST /dictation/clean` | Optional faithful text cleanup |
| `GET /records`, `DELETE /records` | Inspect / clear current owner-scoped history |
| `POST /realtime/ticket`, `GET /realtime` upgrade | Sealed native Realtime transport |
| `GET`, `POST`, `DELETE /keys` | List, issue and revoke owner voice keys |
| `GET /realtime` upgrade with Bearer voice key | `lares-realtime-v1` for server-side callers |

Capture, transcription, synthesis, playback and bounded metrics routes remain in use. Metrics omit transcript/audio/credentials. Synthesis prefetch remains bounded to two requested sentence parts. Host helpers must support playback status; outdated helpers produce an explicit upgrade error.

## Server-side Realtime callers

Lares desktop and mobile (by default) and server-side callers such as Router all use [`lares-realtime-v1`](realtime-protocol.md) on `/api/lares/voice/realtime`: Lares clients with a ticket, server-side callers with `Authorization: Bearer <voice key>`. The voice setting `transport: "legacy"` returns Lares clients to the pipeline endpoints above until device acceptance. What the build implements is listed in the spec's [implementation status](realtime-protocol.md#implementation-status).

The owner issues and revokes voice keys in voice settings (desktop and mobile), backed by the authenticated Host API. Only SHA-256 hashes are stored in `$DSH_HOME/voice-input/keys.json`, and the file is re-read on every connection, so revocation applies to the next connection without a restart. A key lists its allowed models (`voice-dictation`, `voice-chat`, `voice-assistant`, `voice-direct`) and may pin `sessionId` / `workspaceId`. With no key there is no access.

```sh
curl -X POST .../api/lares/voice/keys -d '{"name":"Router","models":["voice-dictation","voice-chat"]}'   # returns the key once
curl .../api/lares/voice/keys                                                                     # list, without secrets
curl -X DELETE .../api/lares/voice/keys -d '{"id":"<id>"}'
```

The caller is the key owner; identity headers on the request are ignored. `voice-assistant` and `voice-direct` operate the owner's Agent, so grant them only to keys whose Router side is restricted to the owner.

Register in Router a provider of type `openai` (Router's Realtime path accepts only that type) with base URL `https://<appid>1.<user zone>/api/lares/voice`, the `webhook-internal` app entrance (the per-user namespace refuses direct Service traffic from router-shared, so Router comes through the internal entrance on 8081), and the voice key as its encrypted credential, models `voice-dictation`, `voice-chat`, `voice-assistant`, `voice-direct` with `mode=realtime` and:

```json
{"extensions":{"voice_service":{"protocol":"lares-realtime-v1","billing":"child-models"}}}
```

Router dials with the key as Bearer and its realtime session ID as `X-Session-Id` (Router ADR-83). Every `response.done` carries all-zero OpenAI `usage`; Router records a zero-charge `usage_in_child_models` row, while the ASR and TTS requests Lares makes for that session carry the same `X-Session-Id` and are metered normally. Dependency model IDs may not point back to the public voice models. Before registering, probe the internal entrance from router-shared.

`@olares/lares-core/voice/protocol-client` wraps an authenticated socket: `configure` (which also announces playback acknowledgement), `append`, `commit`, `discard`, `say`, `playbackProgress`, `playbackCompleted`, `stopOutput` and `cancelTask`. Once a client has sent any playback acknowledgement, the half-duplex server rejects new audio until the current reply is acknowledged. Applications must not feed their speaker output back into ASR.

## Native Realtime gate

Keep both settings disabled/unset until a real model passes acceptance:

```sh
LARES_VOICE_REALTIME_ENABLED=0
LARES_VOICE_REALTIME_VALIDATED_MODELS=
```

Native sockets expose only server-selected tools. Assistant tasks return pending promptly and are monitored independently; actual completion can trigger a later response. User speech and an active model response defer completion announcements. Chat preset has no business tool. Only acknowledged browser playout is eligible for truncation. All shipped hardware adapters still advertise no validated automatic barge-in.

## Verification and remaining acceptance

### PC dictation layout regression after 0.26.49

Installed-page acceptance exposed an extra `display: contents` slot wrapper between the dictation component and dsh's zero-height, absolutely positioned overlay anchor. The former direct-child selector missed that wrapper, so recording and failure controls overlapped the editor. A dedicated `data-composer-overlay` presentation attribute now selects the native anchor without relying on slot nesting; dictation occupies normal layout while the conversation orb retains its overlay positioning.

The waveform and timer appear only during recording. Recognition and failure states use a separate status row; retained original text and recovery actions occupy the next row. Processing failures with retained transcription identify text processing separately from recognition failure.

Regression checks use the production React components with synthetic audio/model ports and the actual slot-wrapper structure. Desktop and 390px checks confirm disjoint editor, voice and toolbar bounds, no horizontal overflow, and recovery appending to an existing draft without submitting an Agent task. These checks do not certify the installed model cleanup call or a real microphone. The deployed 0.26.49 failure remains an outstanding acceptance issue until the corrected build is deployed and tested.

Run `node --import tsx --test tests/plugins/voice-*.test.ts tests/plugins/mobile-layout.test.ts`, `npm run typecheck`, `npm run build` and the complete suite. Protocol tests use actual local WebSockets with mocked inference; they are not real-model or microphone acceptance.

The full suite has a pre-existing failure at `tests/plugins/file-preview.test.ts:1341`: temporary path cleanup raises `ERR_FS_EISDIR`. It is unrelated to voice and was not changed.

Before enabling either external service or native Realtime: verify real models, PostgreSQL composite usage settlement, grants/revocation, browser/iOS/Android permissions and audio unlock, host/Bluetooth leases, long replies, approvals, interrupted speech, background/lock, disconnect/recovery and latency. This change does not deploy, certify hardware barge-in or repeat the earlier yaotest004 single-recording acceptance against the new build.

## Voice panel migration status

Release 0.26.47 introduced application panels and session-message projection. The current development branch simplifies that interaction further; these local changes have not been deployed.

### Implemented locally: one entry and dictation presets

The composer has one voice/keyboard entry following the saved web/mobile mode (web dictation, mobile conversation). Conversation and dictation capture run inline, replacing only the visible editor region while preserving drafts, attachments and tools. Hold/release submits a conversation turn, sliding up cancels (60px arms, below 40px restores sending). Space holds/releases; Enter supports start/finish; Escape cancels the take first, then returns to text. Keyboard return pauses audio without cancelling dsh work. Entering again waits for an explicit hold. Multi-touch, pointer loss, blur, background and session changes discard unsubmitted input. Pressing during output stops speech first; stop-speaking is also available at the owning assistant reply, including deduplicated native task results. There are no resident conversation-panel or End Voice controls.

Fresh dictation starts inline immediately, with available levels, elapsed time and Done. Done recognizes/processes once, then opens editable preview. Only preview uses a desktop entry-anchored modal or mobile/narrow-web bottom sheet; it stays within 85% of the visual viewport. Insert appends to the original draft; Discard clears the take. Keyboard return during capture retains a draft, and closing/reopening preview preserves edits and focuses the entry without starting recording. Retained drafts take priority over the configured default mode. The existing host manual endpoint policy and one-minute recording limit remain; timeout reports an error and never auto-submits.

Config now contains `dictationPreset` (`raw`, `clean`, `outline`, `summary`), `dictationProfiles` (non-raw entries with `model` and `instructions`) and `dictationShortcuts` (`default` plus the four preset keys). Empty shortcuts are unbound. Explicit stored `dictationCleanup` values migrate on read, and writes use the new format. `POST /dictation/clean` accepts `{text, preset, config?: {dictationProfiles}}`; the authenticated Host validates overrides and only transforms text, with no tools. Raw returns directly. ASR model/language and processing profiles are fixed per recording; processing failure preserves original text for retry or direct use.

Native Realtime and external voice gates remain unchanged. The new manual conversation UI explicitly reports unsupported Realtime instead of silently using automatic turns. Real-model, human microphone and physical-device acceptance for these changes is pending. See the target design and implementation plan for the full acceptance matrix.

`POST /api/lares/voice/history` accepts `{sessionId, after, limit, version, waitMs}`. Reads authorize the business session and isolate records by the authenticated owner; they require no active voice ID. Pages return stable record sequences, `version` and `next`; long polling is bounded at 20 seconds and ends on disconnect. Streaming updates preserve record identity and anchor. The shared SDK exports `voice/panel` and `voice/projection`.

The official dsh Chat receives read-only voice rows through the `conversation.chat.timeline` presentation extension. A separate `setExternalActivity` presentation marker lets a session containing only voice records display Chat instead of the empty hero; it does not mutate the dsh journal or prompt the Agent. Both vendor patches apply on npm install and ordinary application-image builds. Vue uses the same projection in its existing Transcript. Native task messages replace temporary echoes, and completed tasks suppress stale pending acknowledgements. History subscriptions have no playback path.

Verification for compact inline input (local development branch): 218 voice/mobile-layout tests pass, as do typecheck and client/mobile/server builds. Full suite: 726/727 pass; the sole failure remains the pre-existing macOS file-preview symlink cleanup (ERR_FS_EISDIR). The Vite mobile bundle-size warning is informational. No version change, push, publication or deployment is included.

The local harness renders actual React/Vue input and preview components with synthetic audio/model ports; the web fixture reproduces dsh composer structure rather than running a deployed dsh app. Browser checks covered single-submit keyboard turns, Escape cancellation, retained original text, editable preview, close/reopen, explicit append without Agent submission, entry focus return, and waiting/recording/cancel/preview screenshots. At 390×400 simulated keyboard pressure, the Vue preview measures 339px high, the action footer ends at 384px, and there is no horizontal overflow. The native dsh zero-height overlay constraint is explicitly accounted for by the inline presentation style.

The SDK adds separate `inputActive`/`previewVisible` flags; gestures retain `cancelArmed` and `setCancelArmed`. UI-only `voicePlayback` metadata ties native result rows to this client's speech. History remains silent. Real installed-page integration, ASR/LLM/TTS, microphones, host/Bluetooth, iOS/Android keyboard panning, safe areas and touch gestures remain pending physical/deployed acceptance. Model/native Realtime gates remain unchanged.
# Dictation cleanup recovery (2026-10-17)

PC dictation now shows the recognized original while text processing is pending. **Use original** interrupts processing immediately, appends the original to the bound conversation draft, and does not send an Agent task. A late cleanup result cannot replace that draft. Vue previews also allow switching to the original during processing; insertion remains a separate confirmation there. Existing processing deadlines retain the original and exit loading on failure; they do not guarantee cancellation of work already queued in the upstream model.

Validation: 255 voice tests passed, including stalled requests ignoring abort, original recovery, late responses, and processing deadlines. Typecheck and client/mobile/server builds passed. Full local dsh PC chat/settings and Vue mobile/desktop chat/settings loaded against the real Host and LAN Router; Vue viewport was 1280×720. Vue desktop's existing `settings/describe` unexpected `request` error remains. The restricted model directory still omits the callable `default-chat` alias; no model or Key configuration was changed. Real microphone recovery, pending-state visual layout, physical phones and Bluetooth remain unverified. No release or remote deployment was performed.


## Streaming regression evidence (2026-10-18)

| Surface | Actual checks | Result / limits |
| --- | --- | --- |
| Official dsh PC, 1280×720 | Concrete model selection in an existing independent test session, real text reply, new stream transport | Text reply passed before restart; the rebuilt page subsequently showed the existing model-directory error despite a successful authorized LAN directory health check. The initial physical-mic attempt failed and its capture cleanup was fixed. Physical-mic retry and audible latency remain unconfirmed. |
| Vue mobile, 1280×720 and 390×844 | Actual chat/history, real model response, raw settings, hidden desktop shortcuts, narrow input layout | Rendering and text transport passed; one model response leaked a closing thinking tag. Speech now filters thinking text, but engine/display normalization is not part of this fix. |
| Vue desktop, 1280×720 | Actual chat/history and settings, visible desktop shortcuts | Basic rendering passed; existing Enter settings RPC descriptor mismatch remains. Full voice acceptance is incomplete. |
| Shared browser audio | Synthetic audio through actual capture and playback worklets, real LAN models | Final transcript/negation and real rendering passed; not physical microphone, phone, echo or Bluetooth acceptance. |

Focused stream/Agent tests pass (13); complete local suite is 801/802, with the
existing macOS file-preview cleanup failure (`ERR_FS_EISDIR`). Typecheck and
PC/Vue/Host build pass. audio-engines: 279 tests pass. Router v1 tests, audio
race, vet and build pass. Model Console proxy race, lint and build pass; its
unrelated ready-lifecycle timing test remains intermittent. No stable P95 is
claimed from this sample count. No push, release or deployment was performed.

### Reply correctness and interruption recovery (2026-10-18)

Use the same build for Host, official PC and standalone Vue preview. An earlier
local Host could remain on older loaded core modules even after files were built;
rebuild, restart, refresh and record the preview build ID together.

The regression fixture is the twelve zodiac animals with ordered-list Markdown
and emoji. Check the original, cleaned segments, synthesis requests and rendered
order separately. A confirmed additional duplication source was simultaneous PC
and Vue views of one session: both requested synthesis for the same reply. The
Host now grants a source once; another observer ends silently with
`voice_output_owned`, rather than replaying it or displaying a spurious error.
Historical and explicitly stopped turns cannot reopen through a later step.

Source-bound speech uses only Host-observed Agent output. No-tools requests may
stream stable text before settlement; normal tool-enabled requests retain the
safe settlement boundary. Fixed text, file-only synthesis and raw TTS APIs retain
their existing contracts. `segment`/`segment.end` metadata identifies ordered
parts; only renderer progress acknowledges PCM consumption. Socket pause is
bounded and does not remove backpressure. Empty, failed and cancelled ASR remain
distinct during interruption recovery. No device's automatic barge-in is enabled
without separate echo acceptance.

Initial verification: 296 voice tests passed. Full suite: 842/843 passed, with the
existing macOS `file-preview.test.ts:1341` symlink-cleanup `ERR_FS_EISDIR` failure.
Typecheck and official PC/Vue/Host builds passed. New HTTP/WebSocket tests verify
source authentication, forged-text exclusion, pre-final audio, one-time claims,
ordered zodiac segments, tool-capable deferral, cancellation and PCM pause position.
Fake-clock tests cover successful empty ASR, valid short speech, explicit stop,
new output identity, timeout and failure without automatic resume.

A real LAN Router fixed-text run produced 12 unique ordered segments, 576000 PCM
bytes at 24 kHz (12 seconds). First audio arrived at 275 ms, synthesis completed in
4477 ms; this warm sample acknowledges received frames immediately and is not a
client-playout or end-of-user-speech benchmark. ASR of that synthetic audio returned
“鼠、牛、鹤、兔、龙、蛇、马、羊、猴、鸡、狗、猪。” The “虎/鹤” discrepancy is unresolved
between model pronunciation and recognition; it is not an audible-correctness pass.
Fixed corpus audio and diagnostic details remain in ignored local debug evidence.

Human listening, microphone noise interruption, echo tests, physical phones and
Bluetooth must be recorded separately and are not passed by automated tests.
No release, deployment, model switch or GPU configuration change is included.

Browser acceptance used an isolated local Host and the real LAN Router. Official
PC (1280×720), Vue desktop (1280×720), and Vue mobile (390×844) each completed a
new chat turn, rendered the shared Reading/Stop controls, and removed the state
immediately after Stop without removing the answer. History did not autoplay.
All three settings views loaded voice configuration; Vue desktop showed shortcuts
and mobile hid them. The pre-existing Vue desktop `settings/describe` unexpected
`request` RPC remains a failed settings item. Default raw dictation and model/voice
choices were retained. The isolated read-aloud preference was restored to false;
the normal local Host's settings and sessions were not overwritten. Active noise
recovery was tested with injected ports and clocks, not certified microphone input.

Evidence includes ignored `__debug__/local-router/readout-acceptance/probe.json`
and its fixed-corpus WAV, plus `lares-readout-{pc,vue-desktop,vue-mobile}-playing.png`
and corresponding settings screenshots in the local Codex visualization output.
The measured first-audio sample is synthesis-only; real no-tools Agent latency,
P50/P95 and physical listening acceptance remain open, not inferred from mocks.

### New-session chat model initialization

The shared core resolves a successful authorized chat catalog in its returned
order: retain a valid saved global default, otherwise persist the first concrete
chat model. There is no MTP name preference or `default` placeholder. Router's
`/models` does not identify the `default-chat` route target; Lares does not query
an administrator catalog to guess it. Boot and runtime reconciliation use the
same rule. Empty or failed catalogs never manufacture a choice, and failures
remain visible and retryable. An automatic fallback clears a previous model's
reasoning override; an unchanged valid selection retains its explicit choice.

The dsh default save queue conditionally accepts automatic initialization only
if its observed selection still holds. Manual saves win either queue ordering.
The session catalog reads its default after reconciliation. Existing session
selections remain independent; changing the global default does not rewrite
history, retry failed tasks or replace running-request snapshots. The composer
shows reasoning only for an available selected model. This initialization fix
does not resolve the separately observed upstream 400/context-budget problem.

Acceptance (2026-10-18): PC 1280×720 returned the fixed test answer using
Qwen3.5-9B-AWQ-4bit; the durable request header matched the displayed model.
Vue mobile 390×844 and desktop 1280×720 plus narrow desktop 390×844 showed
the same default in real chat/settings components. Desktop settings retains
the known unrelated `settings/describe` unexpected `request` error. Final full
suite: 848/849 passed; existing macOS file-preview symlink cleanup fails with
`ERR_FS_EISDIR`. Typecheck, all builds and isolated vendor reverse/reapply
passed. Evidence is in ignored `__debug__/local-router/default-model-acceptance.json`.
No real microphone, Bluetooth or physical-phone acceptance is claimed.

### Mobile composer single-line layout (2026-10-18)

The mobile text composer starts at 36px (border-box, 22px line height plus
14px vertical padding), centered with its 36px controls. Short content shows
the send control without switching to a second row. Actual wrapping/newlines
grow the input up to 176px, then scroll internally. Attachments remain above
the input row. Resizing and return from voice input trigger a fresh measurement;
teardown disconnects the observer. New-session and existing-session layouts
share this component; PC and Vue desktop keep their existing composers.

Real mobile acceptance at 390×844 measured 36px empty/short, 58px for two
explicit lines, and a 176px cap for long content. Eight type/clear cycles,
a successful test send, attachment removal and voice-to-keyboard return all
restored one line. PC and Vue desktop chat smoke passed at 1280×720. The 19
focused tests, typecheck and all builds passed; full suite remains 848/849
with the existing macOS file-preview symlink cleanup failure. Native IME,
physical phone/keyboard and real microphone acceptance are not claimed.
Ignored evidence: `__debug__/local-router/composer-layout-acceptance.json`.


### PCM playback quality investigation (2026-10-18)

Both official PC and Vue sentence readers use the shared browser PCM player;
the saved `streaming` preference does not select a file-only playback path.
Transport chunks must not affect resampling. The worklet now interpolates the
last sample of a block against the next block, retaining fractional position
while that neighbor is pending. Only final EOF permits an edge clamp. Waiting
reports one underrun per starvation episode; pause does not consume samples.

Fixed-model/voice diagnosis used Qwen3-TTS-12Hz-0.6B-CustomVoice, aiden,
Chinese, mono PCM16 at 24 kHz, without changing saved preferences. Five fixed
corpora (natural Chinese, long sentence, numbers/time, zodiac, mixed language)
were run three times through whole WAV, collected native PCM, independent
sentence synthesis and the real Host stream. Fifteen timed replays per path
showed no underruns; no startup buffer or segmentation change was justified.
The thirteen-segment zodiac path took 7.1–11.1 seconds to synthesize, versus
3.3–4.3 seconds whole-file generation. These are completion times, not first
sound latency, and do not prove an audible quality defect.

Native browser capture at 48 kHz compared the exact same collected PCM before
and after the patch: equal duration, 45 changed int16 samples (maximum 1440)
in the old output, and zero sample error against continuous linear interpolation
in the patched output. The user heard the source and patched capture as similar.
The user found whole/segmented files normal but a newly synthesized real-time
capture less natural. Naturalness is therefore NOT accepted as fixed, and the
boundary defect is not claimed as its root cause. The user reports speakers or
wired headphones; Bluetooth call-mode switching is not supported by this case.

Isolated probes leave the microphone closed. They do not establish acceptance
for concurrent capture, hardware output, full Agent scheduling or physical
phones. Keep those observations separate from deterministic sample tests.
Ordinary logs contain only generation/segment identity, counts and timings;
fixed diagnostic text/audio remain in ignored local artifacts. Compare the same
PCM through each path before attributing audible differences to transport,
since separate model invocations can produce different prosody and durations.


Native real-Host playback was repeated three times for each worklet. Old
first-sound times were 476/301/557 ms; patched times were 396/478/281 ms.
All six captures reported zero underruns and closed their AudioContexts.
Different synthesis outputs had different durations, so these runs cannot
establish improved prosody. The shared playback tests passed 12/12, including
odd-byte packet assembly, six rate pairs and pause/late-neighbor behavior.
Typecheck and all builds passed. Full suite before the final extra packet test
was 850/851; the existing macOS file-preview symlink cleanup still fails with
`ERR_FS_EISDIR`.

Official PC 1280×720 and Vue mobile/desktop chat and settings loaded the rebuilt
resources. Mobile layout was checked at an actual 390×844 viewport. PC/mobile
preview entered and stopped, without changing automatic read-aloud. Vue desktop
audition failed on retry and retains its existing `settings/describe` unexpected
`request` error; this is not a successful audio acceptance. Full Agent speech,
concurrent real microphone, pause/resume on hardware and physical devices remain
unverified. Ignored evidence and repeatable probes are under
`__debug__/local-router/tts-quality/` (report, replay, acceptance, WAVs), with
`tts-quality.mjs`, `tts-quality-replay.mjs` and `tts-quality-native.mjs` beside it.

### Chinese speech segmentation candidate (2026-10-18)

Shared structural cleaning now feeds an attempt-owned segmenter in trusted Host
reply streams and the buffered fallback. It preserves paragraph/list/heading/code
boundaries, Chinese sentence punctuation, balanced quotes and parentheses.
The candidate targets 40–80 Chinese-equivalent characters for long prose and
three adjacent short items per list batch, including separator weight. Completed
pending items have a 250 ms Host deadline, independent of new tokens or browser
timers. Stop, retry and session exit discard state; already released text cannot
be regrouped. A reply is parsed only after an authorized speech consumer claims
it, so automatic read-aloud off adds no per-token segmentation work.

The internal `SPEECH_SEGMENTATION_POLICY` remains `legacy` pending same-voice
listening acceptance. Candidate code can be exercised through internal factory
injection; there is no Host route, saved preference or user-visible policy switch.
Existing models, voices, read-aloud settings, raw TTS input and displayed messages
are unchanged. Bracket-to-pause normalization is diagnostic only.

The local comparison used the screenshot's full zodiac response, natural prose,
numbers/time, mixed language and a longer list. All five variants ran three times
per corpus (75 runs, no HTTP/format failures): current Aiden/legacy, Uncle_Fu with
legacy text, Aiden/candidate, same candidate groups without added semicolons,
and candidate groups with brackets changed to pauses. All configuration values
were checked unchanged afterward. The actual request bodies, arrival times,
sample counts and WAVs are retained in ignored local diagnostic artifacts.
These sequential fixed-text runs do not measure live Agent token waiting, cold
start or concurrent microphone capture. Each comparison has only three repeats;
no meaningful production P95 or naturalness conclusion is claimed.

For the zodiac response, requests decreased from 18 to 8 (12 animal entries to
four batches). Median first actual PCM was 245 ms legacy versus 235 ms candidate;
median total synthesis was 13932 versus 12905 ms. Natural prose used 4 versus 2
requests; the longer list used 9 versus 4. These are measurements, not listening
acceptance or permission to change a saved voice. The paired A/B samples use
Aiden in both cases; no choice has been accepted at the time of this record.

Acceptance artifacts: ignored `__debug__/local-router/tts-naturalness/` contains
75 WAVs plus per-request PCM, timing and request-text records, summary and
acceptance JSON; the repeatable driver is `tts-naturalness.mjs` alongside it.
The same-voice blind samples have not received a listening decision, so the
candidate remains disabled as the default. No audible improvement, zero missed
words or production automatic-playback acceptance is claimed from request counts.

Thirteen candidate tests cover arbitrary chunking, code/nesting boundaries,
references/tables, late emoji, unclosed quotes, real Host deadline wake-up,
interruption/retry cleanup and the actual WebSocket-to-HTTP request body.
Full suite: 864/865 passed; only the pre-existing macOS file-preview symlink
cleanup `ERR_FS_EISDIR` failed. Typecheck and PC/Vue/Host builds passed.
Official PC and Vue desktop chat/settings loaded at 1280×720; Vue mobile at
390×844. All three preview start/cancel paths completed; desktop preview also
returned normally this run, but its earlier audition failures are unexplained
and the existing `settings/describe` unexpected `request` error remains. Preview
checks do not establish candidate automatic-voice, concurrent microphone or
hardware playback quality. Those and physical-phone/Bluetooth checks remain open.

Frontend asset IDs can remain identical for Host-only segmentation changes.
The local acceptance record therefore also captures Host core source hashes,
file times and restart time; no new public diagnostic API is introduced.


### Natural segmentation enabled (2026-10-19)

The user preferred blind sample A (natural) over B (legacy), both synthesized
with the same Qwen model and Aiden voice. Natural segmentation is now the shared
default for PC and Vue, including trusted live replies, fixed text and buffered
fallback. The preceding pending-acceptance notes describe the earlier candidate
stage. No model, voice or read-aloud preference was changed. This preference
confirms comparative naturalness, not an exhaustive pronunciation or hardware
acceptance. Legacy remains available internally for repeatable diagnostic A/Bs.

Default-policy regression also protects task-checkbox cleanup, mathematical
comparison signs, code/escaped pipes inside table rows, and unfinished table or
entity tails. Paragraph newlines alone no longer force independent synthesis;
the tests preserve content while checking the accepted structural grouping.

Enabled-default verification: 312/312 voice tests passed; full suite remains
864/865 with the existing file-preview cleanup failure. Typecheck and all builds
passed. A real local Host/LAN Router stream of the accepted zodiac text emitted
8 ordered segments matching the accepted spoken text. Closing a second stream
after first PCM cancelled playback delivery, and a subsequent synthesis succeeded.
Saved model, Aiden voice, streaming and read-aloud preferences were unchanged.
PC and Vue desktop chat/settings loaded at 1280×720, Vue mobile at 390×844;
the existing desktop settings RPC error remains. Automatic speech was not enabled
in each full UI, and real microphone/hardware pause/resume/phone/Bluetooth checks
remain unexecuted. See ignored `tts-naturalness/default-enabled.json` for the
actual scope, build/source hashes and the blind preference decision.


### Optional browser audio prewarming (2026-10-23)

Text submission may prewarm browser playback inside its user gesture, but that
preparation is optional: missing AudioWorklet support, context construction or
synchronous resume failures must not reject a text send. Actual PCM playback and
capture validate the browser capabilities and report a localized secure-connection
or unsupported-audio error. Worklet module URLs are revoked even when loading
throws synchronously; a failed preload remains retryable on real playback.

Validation: 49 focused audio/composer tests, typecheck and PC/Vue/Host builds
passed. The final full suite passed 1056/1056. An initial Router session-affinity
failure passed both in isolation and in the full rerun; its cause is unconfirmed.

| Interface | UI acceptance | Reason |
| --- | --- | --- |
| Official dsh PC | Blocked | Existing local Host returns HTTP 503; configured LAN test profile is not currently logged in |
| Vue mobile: chat and settings | Blocked | Same Host and identity prerequisites; no new build/viewport verified in-browser |
| Vue desktop: chat and settings | Blocked | Same Host and identity prerequisites; no new build/viewport verified in-browser |

No existing services, profiles or remote settings were changed. Real microphone,
playback and physical-device checks remain unexecuted. Local acceptance details
are in the ignored `__debug__/local-router/optional-audio-acceptance.json`.
