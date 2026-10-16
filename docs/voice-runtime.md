# Voice runtime

Architecture and lifecycle contracts: [Voice service design](voice-service-design.md). Delivery/acceptance status: [implementation plan](voice-service-plan.md).

## Implemented behavior

- Web defaults to dictation; mobile defaults to continuous conversation. `mode` and `mobileMode` are independent. Each client offers explicit mode selection.
- Dictation manually finishes or cancels, optionally cleans punctuation/fillers through Router, and inserts editable text. It does not open or submit a dsh task. Draft text and attachments survive asynchronous insertion; cancellation invalidates pending recognition/cleanup.
- Continuous conversations support `chat`, `assistant` and `direct` presets. The `dictation` preset supports successive transcript insertions without an Agent. Native Realtime supports assistant/chat only and stays behind its real-model gate.
- Assistant mode uses Router Chat Completions for conversational turns and delegates business work through a controlled `ask_lares`. Direct mode submits each turn to dsh. Existing presets/skills/tools remain owned by dsh.
- Read-aloud is independent of input mode. Per-connection mute does not alter the saved global setting; unmute does not replay the muted answer. Stop speaking, pause input, close voice and cancel a business task have separate semantics.
- Microphone level and elapsed recording time are shown when the browser exposes levels. No synthetic waveform is used for host devices without a meter. Mobile opens the voice panel on a tap; conversation capture uses hold-to-speak/release-to-submit.
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

Run `node --import tsx --test tests/plugins/voice-*.test.ts tests/plugins/mobile-layout.test.ts`, `npm run typecheck`, `npm run build` and the complete suite. Protocol tests use actual local WebSockets with mocked inference; they are not real-model or microphone acceptance.

The full suite has a pre-existing failure at `tests/plugins/file-preview.test.ts:1341`: temporary path cleanup raises `ERR_FS_EISDIR`. It is unrelated to voice and was not changed.

Before enabling either external service or native Realtime: verify real models, PostgreSQL composite usage settlement, grants/revocation, browser/iOS/Android permissions and audio unlock, host/Bluetooth leases, long replies, approvals, interrupted speech, background/lock, disconnect/recovery and latency. This change does not deploy, certify hardware barge-in or repeat the earlier yaotest004 single-recording acceptance against the new build.

## Voice panel migration status

Release 0.26.47 introduced application panels and session-message projection. The current development branch simplifies that interaction further; these local changes have not been deployed.

### Implemented locally: one entry and dictation presets

The composer has one entry following the saved web/mobile mode. Desktop uses an entry-anchored modal; web below 600px and Vue use a bottom sheet. Preview is capped at 85% of the available visual viewport, with a scrollable editor and fixed action footer. Fresh dictation opens and records immediately; Done produces an editable preview, Insert appends to the original draft, and Discard removes the take. Close retains the draft without inserting it. Conversation waits for a hold, release submits, and slide-up cancels. Cancellation is highlighted while moving: 60px arms it and sliding back below 40px restores sending; the hold button stays in place. Space supports hold/release, Enter supports start/finish, and the first Escape cancels the turn while the next closes the panel. Multi-touch, pointer loss, window blur and background transitions discard unsubmitted input. It never automatically restarts capture. Pressing during output stops speech, without cancelling dsh work. The host microphone uses the same manual endpoint policy. Manual recordings have a one-minute bound; reaching it reports an error and does not automatically submit.

Config now contains `dictationPreset` (`raw`, `clean`, `outline`, `summary`), `dictationProfiles` (non-raw entries with `model` and `instructions`) and `dictationShortcuts` (`default` plus the four preset keys). Empty shortcuts are unbound. Explicit stored `dictationCleanup` values migrate on read, and writes use the new format. `POST /dictation/clean` accepts `{text, preset, config?: {dictationProfiles}}`; the authenticated Host validates overrides and only transforms text, with no tools. Raw returns directly. ASR model/language and processing profiles are fixed per recording; processing failure preserves original text for retry or direct use.

Native Realtime and external voice gates remain unchanged. The new manual conversation UI explicitly reports unsupported Realtime instead of silently using automatic turns. Real-model, human microphone and physical-device acceptance for these changes is pending. See the target design and implementation plan for the full acceptance matrix.

`POST /api/lares/voice/history` accepts `{sessionId, after, limit, version, waitMs}`. Reads authorize the business session and isolate records by the authenticated owner; they require no active voice ID. Pages return stable record sequences, `version` and `next`; long polling is bounded at 20 seconds and ends on disconnect. Streaming updates preserve record identity and anchor. The shared SDK exports `voice/panel` and `voice/projection`.

The official dsh Chat receives read-only voice rows through the `conversation.chat.timeline` presentation extension. A separate `setExternalActivity` presentation marker lets a session containing only voice records display Chat instead of the empty hero; it does not mutate the dsh journal or prompt the Agent. Both vendor patches apply on npm install and ordinary application-image builds. Vue uses the same projection in its existing Transcript. Native task messages replace temporary echoes, and completed tasks suppress stale pending acknowledgements. History subscriptions have no playback path.

Verification for the simplified interaction: 213 focused voice/mobile-layout tests pass; typecheck and client/mobile/server builds pass. A disposable local harness renders the actual React and Vue panels with synthetic audio/model ports. Browser checks confirmed immediate dictation entry, preview, preset regeneration, manual editing/insertion, keyboard conversation start/finish, Escape/focus return, retained drafts on reopen, and a 390×844 mobile layout without horizontal overflow. These checks do not certify real ASR/LLM output or physical microphones/playback. The Vite mobile bundle size warning remains informational. Full suite: 721/722 pass; the sole failure is the existing macOS file-preview symlink cleanup (`ERR_FS_EISDIR`). No version change, publication or deployment is included.

Latest local visual checks captured waiting, recording, cancel and preview states in both actual client components with synthetic audio/model ports. Desktop positioning and menu/edit/insert behavior passed; Vue and narrow React bottom placement passed at 390px width, including an available-height reduction to 400px. The latter simulates keyboard pressure only; actual iOS/Android keyboard panning, safe areas, gestures, microphones and playback remain pending. Timer/level changes do not update live status text. The shared panel API adds `cancelArmed`/`setCancelArmed`, and the preview menu contains preset/original/recovery controls.
