# Voice runtime

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
| `GET /bridge/capabilities` | Composite protocol's actual declared subset and enabled state |
| `GET /bridge/realtime` upgrade | Signed, granted external composite connection |

Capture, transcription, synthesis, playback and bounded metrics routes remain in use. Metrics omit transcript/audio/credentials. Synthesis prefetch remains bounded to two requested sentence parts. Host helpers must support playback status; outdated helpers produce an explicit upgrade error.

## External composite WebSocket

This endpoint is disabled by default. It implements `olares-voice-ws-v1`, not all OpenAI Realtime APIs. It accepts mono PCM16 at 24 kHz, manual commit or server energy/VAD endpointing, and returns transcript/text/audio events. It supports explicit context resume and text-only output. No client tools, arbitrary instructions/business binding, WebRTC, SIP or precise truncation are advertised.

External clients may use `@olares/lares-core/voice/protocol-client` with an already authenticated Router socket. Call `configure`, append base64 PCM frames, then `commit`; `discard` clears input and `stopOutput` stops generation without cancelling Lares. Reconfiguration with `contextId` is allowed only before input/turns; wait for `session.updated` before sending audio after a context change. Call `playbackCompleted()` only after output actually drains; until that acknowledgement, the half-duplex server rejects new audio. Applications must not feed their speaker output back into ASR. There is no automatic transport replay.

Operator configuration (use real deployment secrets; no runtime change is made by source defaults):

```sh
LARES_VOICE_EXTERNAL_ENABLED=0
LARES_VOICE_ROUTER_SECRET=<at-least-32-random-bytes>
LARES_VOICE_EXTERNAL_GRANTS='{"alice":{"presets":["dictation","chat","assistant","direct"],"lares":true}}'
```

Grants are server-controlled. Business grants may pin `sessionId`, `workspaceId` and `agentPreset`; app-only callers cannot receive a business grant. A Lares business grant must match this Host's actual owner. Unidentified callers fail closed. The service verifies HMAC-signed Router principal/model/time/nonce claims and rejects replay; client identity headers do not grant access.

Router registration uses an OpenAI-compatible provider whose base URL ends in `/api/lares/voice/bridge`, with the shared signing secret as the encrypted provider credential. Register model names `voice-dictation`, `voice-chat`, `voice-assistant`, `voice-direct`, `mode=realtime`, and explicit metadata:

```json
{"extensions":{"voice_service":{"protocol":"olares-voice-ws-v1","billing":"child-models"}}}
```

Router signs a fresh resolved identity on each upstream dial. Composite responses are trace records with zero extra model charge and `usage_in_child_models`; actual child ASR/LLM/TTS calls retain their own usage. No native token counts are invented. Dependency IDs may not point back to the public voice models. See Router ADR-81 and branch `codex/composite-voice-service` (commit `de57be9b`).

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
