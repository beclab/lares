# Voice service delivery plan

Design authority: [Voice service design](voice-service-design.md). Runtime evidence: [Voice runtime](voice-runtime.md).

## Delivery order

- [x] Document architecture, presets, lifecycle diagrams, memory and delegation contract.
- [x] Verify dsh queue/steer and cross-client turn ownership; add regression tests before changing tracking.
- [x] Implement shared service/session interfaces, presets, independent defaults, dictation and draft preservation.
- [x] Implement owner-scoped text records, versioned recovery summaries and record inspection/deletion.
- [x] Implement conversational Router LLM delegation, task progress, explicit pause/resume and resource deadlines.
- [x] Update web and mobile controls; separate single dictation from tap-to-start conversation.
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

## Anchored voice panels and live cancellation delivery

- [x] Shared live cancel selection with 60px/40px hysteresis; pointer capture, multi-touch cancellation, pointer loss and keyboard/assistive operation. Core exposes cancelArmed and shared presentation states.
- [x] Desktop entry-anchored modal with flip/clamp/resize behavior; narrow web and Vue use bottom sheets. Preview is bounded by the visual viewport and keeps its footer reachable. No panel drag gesture.
- [x] Stable hold-button geometry, visible cancel target, text/icon/color feedback and semantic-only live announcements. Presets/original/retry are grouped in a compact preview menu.
- [x] 213 focused voice/mobile-layout tests pass; typecheck and client/mobile/server builds pass. Full suite: 721/722 pass, with only the existing file-preview.test.ts:1341 macOS cleanup failure (ERR_FS_EISDIR).
- [x] Actual React/Vue components rendered in a disposable synthetic-audio/model harness. Captured waiting/recording/cancel/preview on both clients; checked menu selection, editing/insertion, two-step Escape/focus return, 390×844 bottom sheets, and editing/footer reachability at a simulated 390×400 keyboard-constrained viewport. Narrow React uses the same bottom placement. No horizontal overflow.
- [ ] Physical keyboard/gesture and actual soft-keyboard acceptance on iOS/Android, real microphone/playback and host/Bluetooth tests after separately authorized deployment. Browser viewport simulation is not physical-device acceptance; visual cancel-state fixtures are not real microphone evidence.

Deliver shared core, dual-platform presentation and documentation as separate commits. No push, PR, release, version bump or deployment is included.
