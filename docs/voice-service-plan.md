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
- [ ] Add stable updatable records, ordering, anchors, authenticated pagination/subscription and task correlation.
- [ ] Add shared panel/draft lifecycle and SDK binding; fence late results on session changes.
- [ ] Migrate web and LarePass Vue controls to an accessible overlay/full-screen panel; retain the official dsh chat shell.
- [ ] Verify close/reopen, tab switches, draft preservation, empty input, multi-client history, native task deduplication, approvals, failures and reconnects.
- [ ] Run focused/full tests, typecheck/build and desktop/narrow-screen browser inspection.
- [ ] Verify new build on yaotest004 with human speech/playback and physical mobile devices after a separately authorized deployment.

Deliver documentation, core projection and dual-platform UI as separate validated commits. This implementation does not authorize another release, package publication or deployment.
