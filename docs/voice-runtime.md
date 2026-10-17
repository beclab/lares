# Voice runtime

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
