# Voice service delivery plan

Design authority: [Voice service design](voice-service-design.md). Runtime evidence: [Voice runtime](voice-runtime.md).

## Single dictation selector revision — 2026-10-17

- [x] Replace preset rows and separate default/edit actions with one Dictation style selector on React/Vue; the confirmed style selects the expanded configuration.
- [x] Remove independent editor state and list styles. Keep raw no-LLM text, six-line processing instructions, independent saved profiles and draft-only Reset/Save/Cancel.
- [x] Share guarded selection: Save/Discard/Keep editing before switching dirty profiles; failed writes keep the previous style and expose an inline error; pending selection prevents competing writes.
- [x] Preserve existing configuration/API shapes, always-visible desktop shortcuts and all recording/task behavior.
- [x] Run 274 related tests, typecheck and complete builds. Full suite: 777/778; only the known file-preview cleanup failure remains.
- [x] Verify the complete official dsh page against the real LAN Router and the actual Vue settings component under mobile/desktop identities. Verify automatic switch, raw hiding, dirty continuation/discard, and restore temporary settings.
- [ ] Exact narrow-screen and packaged LarePass hardware/navigation acceptance remain separate; a desktop component preview does not certify them.

This revision replaces the four-row settings presentation described in the earlier delivery below. Local commits only; no push, version change, release or deployment.

## Lares entry policy and settings revision — 2026-10-17

- [x] Share per-connection Lares policy across React/Vue: dictation returns a draft; conversation uses direct dsh execution with pipeline audio. Preserve generic API presets, native Realtime and saved defaults.
- [x] Validate optional session backend override and preserve it on reopen. Direct mode creates no independent voice dialogue or summary-model call. Gate Lares conversation on ASR/TTS and the current routable Agent configuration.
- [x] Remove API-level strategy/model/backend controls from both product settings surfaces; preserve ASR/TTS, language, device, read-aloud, dictation profiles and mobile default interaction.
- [x] Earlier four-row preset presentation delivered; superseded by the single-selector revision above.
- [x] Expand shortcut settings on web; show Vue shortcuts only for explicit desktop host identity. Reuse recorder, validation, clear/retry and focus behavior. Export Vue leave guard integration for LarePass navigation.
- [x] Run 273 related tests, typecheck and all builds. Full suite: 776/777; only the known file-preview cleanup failure remains.
- [x] Verify the complete official local dsh page against the real LAN Router. Verify the exported Vue settings component against the same Host for mobile/desktop identity, raw profile and shortcut cancellation. Preserve saved settings after checks.
- [ ] Fix the separately observed, existing Vue desktop Enter-behavior RPC descriptor mismatch; it is outside this voice settings change.
- [ ] Verify exact 390px visuals, packaged LarePass navigation integration, physical mobile microphone/gestures, playback and Bluetooth. Component preview/SSR tests do not replace these checks.

Deliver core policy, dual-platform settings and documentation as separate local commits. No push, PR, version bump, release or deployment. The sections below retain earlier delivery history; this revision supersedes their global product strategy controls and collapsed settings layout.

## PC composer revision — 2026-10-17

- [x] Keep the official editor visible during conversation; dictation temporarily replaces the whole composer presentation with voice controls while preserving mounted drafts and attachments. Separate microphone dictation from the dynamic primary action. Compact model ID and preserve full title, accessibility text and reasoning effort.
- [x] Process dictated text with the authenticated request identity, independently of audio connection IDs; cover the actual HTTP route and raw zero-model bypass.
- [ ] Deploy the exclusive dictation surface and cleanup-route correction, then repeat real microphone acceptance.
- [x] Add a minimal native primary chain and session-scoped pre-submit hook; preserve native send/stop and queue/steer. Await audio pause before text sends and reject stale/double sends.
- [x] Reuse automatic VAD turns on PC with an orb and explicit pause/resume. Keep mobile hold/release and preview behavior unchanged.
- [x] Inline PC recording/recognition and append converted text directly; retain raw recovery, draft ownership and configuration snapshots.
- [x] Gate voice controls on discovered capabilities; retain known capabilities during temporary refresh failure. Remove the PC default-mode selector. Native Realtime and barge-in gates remain unchanged.
- [x] Record 226 passing voice/mobile-layout tests, successful typecheck/builds, actual-component screenshots and local official dsh Host integration in the runtime document. Full suite: 734/735, with the existing file-preview cleanup failure.
- [ ] Real microphone, echo, mobile hardware and deployed-page acceptance remain separate. This change does not push, release or deploy.

The sections below describe earlier deliveries; the PC revision supersedes their single-entry/hold-to-speak/preview behavior on desktop only.

## Delivery order

- [x] Document architecture, presets, lifecycle diagrams, memory and delegation contract.
- [x] Verify dsh queue/steer and cross-client turn ownership; add regression tests before changing tracking.
- [x] Implement shared service/session interfaces, presets, independent defaults, dictation and draft preservation.
- [x] Implement owner-scoped text records, versioned recovery summaries and record inspection/deletion.
- [x] Implement conversational Router LLM delegation, task progress, explicit pause/resume and resource deadlines.
- [x] Update web and mobile controls; separate dictation from manual hold-to-talk conversation.
- [x] Add Router composite voice upstream, authorized user grants, capabilities and layered usage.
- [x] Validate mocked native/composite protocol subset, signed identity and external SDK controls.
- [ ] Validate against real native/composite models and PostgreSQL composite settlement.
- [x] Run focused/full regression and typecheck/build; record the unrelated file-preview cleanup failure.
- [ ] Complete real browser/mobile/host/Bluetooth model and hardware acceptance; do not enable gates before it passes.

## Verification and rollout

Each implementation unit gets its own validated commit. Keep unvalidated transports/models gated. Capture failed acceptance and unresolved requirements explicitly; never mark planned behavior as shipped. No automatic push, PR, deploy or version bump.

Cross-client records append independently. Request tracking follows dsh turn boundaries and claimed rpcId sources; a map alone does not establish ownership. Reconnects query stable requests and do not replay historical speech.

## Verification evidence

- Local native/composite protocol tests exercise real WebSockets and mocked model responses; no provider credentials are sent to clients.
- Router API, realtime transport and billing packages pass, and the gateway builds. PostgreSQL-specific integration remains a separate gate.
- Web/mobile bundles and server typecheck/build pass. Actual mobile microphone/background behavior and physical device latency remain unverified for this build.
- External voice stays disabled; native Realtime and automatic barge-in remain gated. No code was deployed, pushed or published.

Final local verification: 168 focused voice/mobile-layout tests passed. The full Lares suite passed 676/677, with only the documented pre-existing file-preview cleanup failure. Typecheck and web/mobile/server builds passed. Local desktop and 390×844 mobile entry layouts were inspected; this is layout verification, not real microphone/device acceptance.

## Voice panel and message projection delivery

- [x] Specify separate panel/session lifetimes, pause-on-close, explicit resume, draft completion, first-valid-input session creation and session-scoped projection.
- [x] Add stable updatable records, ordering, anchors, authenticated pagination/subscription and task correlation.
- [x] Add shared panel/draft lifecycle and SDK binding; fence late results on session changes.
- [x] Migrate web and LarePass Vue controls to an accessible overlay/full-screen panel; retain the official dsh chat shell.
- [x] Verify close/reopen, tab switches, draft preservation, empty input, multi-client history, native task deduplication, approvals, failures and reconnects.
- [x] Run focused/full tests, typecheck/build and desktop/narrow-screen browser inspection.
- [ ] Verify new build on yaotest004 with human speech/playback and physical mobile devices after a separately authorized deployment.

Deliver documentation, core projection and dual-platform UI as separate validated commits. This implementation does not authorize another release, package publication or deployment.

### Previous panel implementation verification

184 focused voice/mobile-layout tests pass. Full suite: 692/693 pass; the sole failure remains the pre-existing macOS file-preview symlink cleanup (`ERR_FS_EISDIR`). Typecheck and client/mobile/server builds pass. Browser inspection used the actual local Host and two synthetic stored voice records: the official web Chat and Vue Transcript both display the records after refresh; no Agent prompt or manufactured execution event was required. Web dialog and 390×844 Vue full-screen panel entry/close/focus behavior were inspected. Core/mock tests cover delegation through approval and completion using both native client message shapes.

This is not human microphone or audible output acceptance. The complete physical-device/browser failure matrix, yaotest004 speech, iOS/Android background/lock behavior, Bluetooth and native Realtime remain unverified. Existing gates stay closed; no release or deployment is included.

## Simplified voice entry and dictation preset delivery

This section supersedes earlier two-entry/tab and automatic-listening UI instructions.

- [x] One composer voice entry follows separate web/mobile defaults; settings changes update the entry.
- [x] Four dictation presets with independent LLM models/instructions for clean, outline and summary; raw bypasses the LLM. Validate settings and migrate the explicit legacy cleanup choice.
- [x] Immediate dictation capture, explicit Done, editable preview, original transcript, retry/use-original, preset regeneration and explicit insertion/discard.
- [x] Shared manual-turn controller and hold/release/slide-up behavior; no VAD endpoint or automatic re-listen for Lares conversation UI. Stop output independently of task cancellation.
- [x] Optional validated page-focused preset shortcuts; mobile settings configure the same processing profiles.
- [x] Core regressions cover pending startup, late results, editing, original-text reuse, cleanup failure and model/tool boundaries.
- [x] 204 focused tests pass; full suite 712/713 with the existing macOS file-preview cleanup failure (`ERR_FS_EISDIR`, file-preview.test.ts:1341). Typecheck and client/mobile/server builds pass.
- [x] Inspect actual React/Vue panels in a disposable browser harness with synthetic audio/model ports: recording/preview, preset regeneration, editing/insertion, keyboard turns, close/focus return and retained drafts. Vue 390×844 has no horizontal overflow.
- [ ] Human speech/playback, physical iOS/Android and host/Bluetooth validation after separately authorized deployment.

Native Realtime remains gated; the current UI rejects Realtime push-to-talk explicitly until its protocol supports and passes manual-turn acceptance. Generic SDK/native protocol behavior is retained. No version change, publication or deployment is included. Dictionaries, automatic style learning, native global hotkeys and input-method integration remain deferred.

## Previous anchored-panel delivery (presentation superseded below)

- [x] Shared live cancel selection with 60px/40px hysteresis; pointer capture, multi-touch cancellation, pointer loss and keyboard/assistive operation. Core exposes cancelArmed and shared presentation states.
- [x] Desktop entry-anchored modal with flip/clamp/resize behavior; narrow web and Vue use bottom sheets. Preview is bounded by the visual viewport and keeps its footer reachable. No panel drag gesture.
- [x] Stable hold-button geometry, visible cancel target, text/icon/color feedback and semantic-only live announcements. Presets/original/retry are grouped in a compact preview menu.
- [x] 213 focused voice/mobile-layout tests pass; typecheck and client/mobile/server builds pass. Full suite: 721/722 pass, with only the existing file-preview.test.ts:1341 macOS cleanup failure (ERR_FS_EISDIR).
- [x] Actual React/Vue components rendered in a disposable synthetic-audio/model harness. Captured waiting/recording/cancel/preview on both clients; checked menu selection, editing/insertion, two-step Escape/focus return, 390×844 bottom sheets, and editing/footer reachability at a simulated 390×400 keyboard-constrained viewport. Narrow React uses the same bottom placement. No horizontal overflow.
- [ ] Physical keyboard/gesture and actual soft-keyboard acceptance on iOS/Android, real microphone/playback and host/Bluetooth tests after separately authorized deployment. Browser viewport simulation is not physical-device acceptance; visual cancel-state fixtures are not real microphone evidence.

Deliver shared core, dual-platform presentation and documentation as separate commits. No push, PR, release, version bump or deployment is included.

## Compact inline composer delivery

- [x] Create and inspect a static four-state web/mobile preview against the original v0.26.44 Vue composer before implementation.
- [x] Separate shared input activity from preview visibility; preserve draft/session ownership, preparation cancellation and deadlines. Reject duplicate Done while conversion is pending.
- [x] Move conversation and dictation capture into the React/Vue composer. Keep one voice/keyboard entry; preserve drafts, attachments and native tools. Conversation has no dialog or resident End Voice control.
- [x] Open a dialog only for editable dictation preview: desktop anchored above the entry, mobile/narrow web bottom sheet. Retain preset/original/retry menu and explicit insertion/discard.
- [x] Keep stop-speaking on the owning reply, including deduplicated native task results; stopping output never cancels the task.
- [x] Run 218 voice/mobile-layout tests, typecheck and client/mobile/server builds successfully. Full suite: 726/727 pass; the existing macOS file-preview symlink cleanup failure remains (ERR_FS_EISDIR).
- [x] Inspect actual components using synthetic audio ports: web Escape cancels with zero submits; mobile Enter start/finish submits once; keyboard return retains text; preview edits survive close/reopen and take priority over conversation defaults; insertion appends without submitting; closing restores entry focus. Capture waiting, recording, cancel and preview states on both clients.
- [x] Check 390px width and simulated 390×400 keyboard pressure: preview height 339px, footer bottom 384px, no horizontal overflow. Verify the native web zero-height overlay takes its inline content height rather than overlapping the tool row.
- [ ] Verify actual installed dsh page, physical microphones, iOS/Android keyboards/safe areas/gestures and Bluetooth after separately authorized deployment. Synthetic component checks do not certify real audio/model behavior.

Deliver shared state, dual-platform input presentation and documentation as separate local commits. No push, PR, version change, publication or deployment is included.


## Streaming pipeline

See [Streaming voice runtime](voice-streaming.md) for the shared ASR/TTS transport,
AudioWorklet lifecycle, bounded playout credit and safe dsh speech boundary.
Streaming capture does not submit partial transcripts; speculative tools remain
out of scope. Streaming is independent of the legacy GPU reading-mode setting.


## Router effort identifiers (local implementation, 2026-10-18)

- Preserve native effort IDs, order and defaults across catalog, dsh, PC and Vue;
  distinguish omitted defaults from explicit `none` and retain unknown IDs.
- Bind capability validation and final request construction to one prepared
  snapshot. Normalize only unambiguous legacy session `off` selections, persist
  before admission, and reject invalid efforts before queue/steer/voice prompts.
- Verify actual dsh HTTP payloads, non-Router behavior, removal of an option,
  persistence failures, upstream error bodies/codes and empty-body 400s.
- Real Qwen direct HTTP/SSE default/none/high controls succeeded. Full Agent
  response completeness and the historical 400 remain separate acceptance items;
  do not classify them as solved from a successful short model request.
- No Router/Model Console deployment, GPU policy, global preference or engine
  parameter change is included. See the dated runtime evidence below.


## Completed locally: TTS preferences and original transcript default

- Shared per-model voice map, exact IDs, explicit default, save failure recovery
  and directory/error states; no preferred-voice substitution.
- Official PC and Vue mobile/desktop model/voice controls with cancellable
  fixed-text preview, independent of read-aloud and task submission.
- Raw dictation defaults and reset paths; explicit saved presets remain intact.
- 278 voice tests, typecheck and all builds pass; full suite 824/825 with the
  existing file-preview cleanup failure. Real LAN TTS/ASR checks and browser
  matrix are recorded in voice-runtime.md; manual audio/device acceptance and
  the existing Vue Enter settings RPC failure remain separate.
