# Lares voice session handoff — 2026-10-25

## Device voice (Reachy Mini through Router) — 2026-10-25

Continue on `feat/ha-connection-leaked-tool-call` (PR 67). Lares 0.26.81 is
running on pptest03; what it does, what was learned getting there and how to
test it are in [voice-runtime](voice-runtime.md#device-voice-through-router-reachy-mini-on-pptest03-2026-102425).

| On pptest03 | Version | Note |
| --- | --- | --- |
| Lares | 0.26.81 (upload source); 0.26.82 built, not deployed | Silero device gate, echo word check, settled-words and short-take endpoints, hass-cli 0.0.2 |
| reachymini | 0.1.7 (upload source) | `lares` dialect, ReSpeaker USB access; main says 0.1.6 |
| Qwen3-ASR 0.6B | 1.0.2 (market.test) | engine v1.1.33, `ENGINE_MAX_CONCURRENCY=3`; the one in use |
| Qwen3-ASR 1.7B | 1.0.30 (market.test) | stopped: no card with 12 Gi free |
| sglang Qwen3.5-9B | 1.0.4 (market.test) | thinking off at launch |

**0.26.82 is built and on Docker Hub but not deployed** (pptest03 was needed for
other work). It fixes what the 0.26.81 robot test showed: spoken commands of
1.1–1.3 s were dropped as too short, because the take endpoint still counted a
frame as speech only above 30% of the take's peak; under Silero the model's
verdict alone now counts. The fragments that reached ASR explain the nonsense
replies in that test ("幾年後", "把房门关下来" answered as a door). The same test
measured the Agent with hass-cli 0.0.2: 6 model calls, done in 4.7 s, against
10 calls and about 14 s before.

Next: deploy 0.26.82 (`olares-cli market upload artifacts/lares-0.26.82.tgz`,
then `market upgrade lares -s upload --version 0.26.82`), retest turning lights on
and off, and check the `device-take` metrics for takes ending `short`. ASR's
language is unset in voice settings, so Qwen3-ASR sometimes answers Chinese in
Traditional characters and the dialogue follows; not changed yet. Then the open
items listed in voice-runtime. Full suite: 1126 pass; the two
known failures (`actual dsh adapter sends Router identifiers…`, `actual session
catalog waits for default initialization…`) predate this work.


## Continuation — 2026-10-19

This section supersedes the historical closeout below. Continue on
`codex/voice-startup-latency`; current product revision is `c14e8bc`.

| Commit | Confirmed fix |
| --- | --- |
| `773147e` | Failed capture finalization now cancels the upstream ASR stream as well as releasing the audio graph. A missing worklet flush previously left the socket open after `voice_timeout`. |
| `c14e8bc` | Dictation transforms no longer reserve a fixed 8192 output tokens. Router chooses the output budget for the configured model/group; dialogue budgets and truncated-output rejection remain intact. |

Both defects have regressions that failed before the fix. The cleanup failure was
reproduced through the real Host: HTTP 502 represented an upstream HTTP 400,
`max_tokens_exceeds_model_limit`, because the configured `default-chat` backend
allows 4096 output tokens. An isolated request with the same model and no output
override succeeded; after rebuilding, the actual `/dictation/clean` route also
returned 200 and preserved the negation. This identifies this round's cleanup
failure, **not** the cause of the historical 400 or earlier human-mic failure.

Final runtime build: `c14e8bc-6ab7efeb1635-d3b20f2218c7-c2f3c2257f0e`, built
`2026-10-18T17:27:35.532Z` (2026-10-19 local time). Both complete product and
standalone Vue preview builds passed; existing large-chunk warnings remain.
Full suite: **873/873 passed**, no skipped tests; typecheck passed.

| Surface | Actual viewport | Result | Evidence / outstanding acceptance |
| --- | --- | --- | --- |
| Official dsh PC | 1280×720 | Test history, model/composer and voice settings passed; audition start/cancel passed | `lares-continuation-pc-{chat,settings}.png`; real microphone and audible output not executed |
| Vue mobile: chat + settings | 390×844 | Test history/composer, raw preset, aiden, saved speak preference and hidden shortcuts passed; audition start/cancel passed; multi-digit list markers have a visual defect | `lares-continuation-mobile-{chat,settings}.png`; browser viewport only, physical phone not executed |
| Vue desktop: chat + settings | 1280×720 | Test history/composer and settings passed; shortcuts visible; audition started and ended without a visible/browser error; multi-digit list markers have a visual defect | `lares-continuation-desktop-{chat,settings}.png`; human listening not executed; earlier audition failure not reproduced or attributed |

All pages were refreshed or navigated after the final rebuild. Vue showed the
final build marker; PC used the rebuilt official Host. Screenshots were taken
after history and settings loaded. Absolute screenshot paths and statuses are
indexed locally in ignored `__debug__/local-router/continuation-evidence.json`.

Real-model checks used the existing authorized identity and verified LAN/TLS:
Vue request transport returned a 257324-byte WAV; buffered and streaming ASR
final succeeded and retained the negation; raw preserved the exact input;
optional cleanup succeeded. Audio was synthetic, held in memory, and not saved.
The cleanup sample took about 31 seconds; success is not a latency improvement.
No Agent task was submitted or historical failed task replayed. The saved voice
configuration fingerprint was unchanged across both restarts and checks.

Local evidence: `continuation-probe.json`, `continuation-cleanup.json` (new 400
with request ID and upstream error), `continuation-cleanup-default.json`,
`continuation-tests.log`, `continuation-cleanup-before.log` and
`continuation-cleanup-after.log`. Existing launcher `build.log` and `vue-build.log`
contain the successful final builds. Treat these files as private diagnostics;
do not commit credentials, recordings or captured user content.

### Current remaining work

1. Human microphone: reproduce any remaining failure by capture, ASR final,
   processing and insertion stage. Verify draft/attachment preservation and no
   automatic task submission. The flush failure is covered automatically; its
   failure/recovery UI was not injected into a live browser this round.
2. Human speaker/wired-headphone playback, pause/end/stop, session changes and
   late replies remain unexecuted. Automatic tests pass for successful-empty-ASR
   noise recovery, real speech stopping output, failed ASR never resuming,
   explicit cancellation and stale-output fencing. Hardware echo gates remain.
3. Physical phone, Bluetooth, complete LarePass and acoustic echo remain
   unexecuted; do not enable automatic interruption on untested devices.
4. Historical 400 and Chrome stalled requests remain unattributed. New failures
   must retain sanitized request ID, model, reasoning selection, token budget,
   upstream body/status and timings. Missing fields must be recorded as missing.
5. GPU lease waiting remains the separate runtime issue documented in
   [Voice streaming](voice-streaming.md#observed-shared-gpu-bottleneck). No engine,
   model or GPU policy was changed.
6. Separate UI follow-up: Vue ordered-list items 10–12 visually lose the leading
   digit in their markers, although the DOM retains full numbering. The final
   chat screenshots retain this observation; no renderer fix is claimed.

Keep the accepted A segmentation, current model, `aiden`, raw dictation and saved
read-aloud/reasoning preferences. No public API, version, model/engine/GPU setting,
Key or remote deployment changed. Nothing was pushed, published or deployed.

## Previous closeout (historical snapshot)

Continue on `codex/voice-startup-latency`. Product runtime revision:
`b752d37f4218305b034131207a1c27bf9c59692d`. A subsequent documentation-only commit
contains this handoff; use `git log -4 --oneline` for its final identity.

| Commit | Independently verified change |
| --- | --- |
| `d972101` | Vue settings RPC matches the installed Host descriptors: empty describe args and direct named update args; strict fixtures cover read-only and revision-conflict errors. |
| `ea60180` | macOS file-preview tests unlink their owned temporary workspace symlink without recursively following its target. |
| `b752d37` | Active-only PC voice indicator; shared read-aloud synchronization, startup ordering, deduplication, recovery and stale-session fencing; bilingual synchronization error message. |

No changes were pushed, published or deployed. No model, engine, GPU, API default,
repository rule or saved voice preference was changed by this closeout. The
runtime and launcher use the existing authorized identity and certificate checks.

Earlier work retained on this branch:

- Lightweight capability loading and permission acquisition on click, with
  cancellation and late-authorization cleanup.
- One dictation selector with expanded configuration and protected editing
  drafts; raw transcription is the default for new/unconfigured preferences.
- Separate Lares dictation and direct-session conversation policies. API preset
  and backend defaults remain separate from product entry behavior.
- Authorized model-directory coordination, concrete model selection, new-session
  defaults, unavailable states and task admission validation.
- Router reasoning choices preserved verbatim, including explicit `none`; model
  default omits an override. Output-budget handling is a separate fix.
- Model-bound TTS voices and explicit audition, shared Markdown/emoji cleanup,
  trusted reply boundaries, progressive PCM playback and cancellation.
- Cross-chunk PCM interpolation continuity; Vue mobile single-line composer.
- Natural Chinese segmentation accepted by the user's blind preference **A over
  B**, enabled in `46911cf`. This closeout does not change its values or grouping.
- A false-interruption recovery implementation exists, but automatic barge-in
  remains gated on echo-tested input and precise-pause playback capabilities.

## Local run and evidence

The following helper files already exist in this local checkout and are ignored;
they are not a fresh-clone installation procedure. Never commit their config,
credentials, data, captured text or audio.

```sh
node __debug__/local-router/local.mjs check
node __debug__/local-router/local.mjs restart
node __debug__/local-router/closeout-http.mjs
npm test
npm run typecheck
```

`restart` builds PC, mobile, server and the standalone source Vue preview. Then
refresh every page and compare its build marker. Do not introduce HMR or another
port to work around old assets. The local launcher now atomically replaces its
private state JSON: a real restart exposed a race where the preview read an empty
file while the parent was rewriting it. The local helper fix remains ignored.

- Official PC: `http://127.0.0.1:18117/?ui=pc`.
- Vue chat: `http://127.0.0.1:18118/?view=chat&device=mobile&locale=zh`.
- Vue settings: `http://127.0.0.1:18118/?view=settings&device=mobile&locale=zh`.
- Use explicit `device=desktop` for both desktop components; width is independent.
- Host binds `0.0.0.0:18117`; preview binds `127.0.0.1:18118`. Ports 18119/18120
  were not listening at closeout. No additional debug listener was left running.
- Final runtime build: `b752d37-8f30fcc1d808-2133180bf46a-c2f3c2257f0e`, built
  `2026-10-18T16:55:17.009Z` (2026-10-19 local time).

Evidence stays local under `__debug__/local-router/`:
`closeout-http.json`, `closeout-ui.json`, `closeout-tests.log`,
`closeout-typecheck.log`, `closeout-build.json`, and `closeout-evidence.json`.
The last file indexes screenshots by absolute local path. Existing naturalness
artifacts live under `tts-naturalness/`: `default-enabled.json`, `acceptance.json`,
`report.json`, blind audio and its private mapping. These are diagnostic evidence,
not ordinary application logs. Do not copy user recordings into tracked docs.

## Validation and limits

| Layer / surface | Result | Limits |
| --- | --- | --- |
| Full automated suite | **871/871 passed**, no skipped tests | Includes settings wire arguments, read-only/conflict behavior, lifecycle, synchronization failure/retry, startup races, stale sessions and late replies. |
| Typecheck and complete builds | Passed | Existing large-chunk build warnings remain; no bundle-size optimization was attempted. |
| Real local Host | Describe, update, reload and restore passed; manual VoiceSession pause/resume/end and read-aloud synchronization passed | The test input/playback ports do not use a microphone or browser speaker. It sends no prompt, task cancellation or synthesis request. |
| Official PC, 1280×720 | History, model, composer, settings, raw preset, voice selection and idle indicator smoke passed | Active microphone/audio state presentation is covered automatically, not a new human playback acceptance. |
| Vue mobile, 390×844 | Real chat/history and settings smoke passed; raw preset and saved voice visible; shortcuts hidden | Browser viewport, not a physical phone. |
| Vue desktop, 1280×720 | Real chat/history and settings smoke passed; shortcuts visible; Enter save/reload/restore passed | Earlier audition failure is not newly diagnosed or claimed resolved. |

There were browser-automation timeouts during one preview navigation and one PC
startup wait. Loaded pages recovered on inspection; final screenshots use the
rebuilt resources. This is not evidence that the earlier Chrome stalled-request
performance issue has been fixed.

The saved local preference at closeout explicitly enables read-aloud. It was
preserved (voice config bytes unchanged by protocol tests); the product default
for a new/unconfigured preference remains **off**. Keep the current model, voice
`aiden`, raw dictation and explicit reasoning choice when continuing. Do not force
preferences to match older acceptance notes.

## Previous remaining work (historical snapshot)

1. **Historical 400:** the earlier upstream error body was not retained, so its
   exact cause is still unknown. The independently fixed context/output-budget
   defect is not proof of that historical cause. On recurrence retain sanitized
   request ID, concrete model, explicit/default reasoning, token budget and
   upstream error body; mark a missing body honestly. Do not retry old tasks.
2. **Transcription failure:** reproduce and distinguish capture, final ASR,
   optional text cleanup and draft insertion. Raw dictation must not call an LLM
   or submit a task. Preserve existing drafts and attachments.
3. **Human audio:** separately verify speaker and wired-headphone readout,
   microphone, actual pause/end/stop, session switching and late replies. Compare
   source text, cleaned segments, synthesis requests and audible output before
   attributing wrong speech to TTS. Existing recordings were not re-accepted here.
4. **False interruption:** noise may resume only the same paused output after
   successful empty ASR and the guard conditions. Real speech stops old output;
   explicit stop, failed ASR, backgrounding and a session change must never resume.
   Do not enable automatic interruption for untested devices.
5. **Device gates:** physical phone, Bluetooth, echo behavior and the complete
   LarePass bridge remain separate unverified items. Browser mobile/desktop
   previews do not pass these gates. Recheck the prior Vue desktop audition issue
   rather than silently removing its record.

Suggested continuation prompt:

> Read docs/voice-handoff.md and the local workspace Lares debug guide. Inspect the
> current checkout and preserved preferences first. Continue only the remaining
> human voice / false-interruption / recurring-error investigation agreed with
> the user. Retain the accepted A segmentation; keep actual PC, Vue mobile and Vue
> desktop evidence separate. Do not replay failed tasks, change models/engines,
> push, release or deploy without a new explicit request.
