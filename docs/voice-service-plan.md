# Voice service delivery plan

Design authority: [Voice service design](voice-service-design.md). Runtime evidence: [Voice runtime](voice-runtime.md).

## Delivery order

- [x] Document architecture, presets, lifecycle diagrams, memory and delegation contract.
- [ ] Verify dsh queue/steer and cross-client turn ownership; add regression tests before changing tracking.
- [ ] Implement shared service/session interfaces, presets, independent defaults, dictation and draft preservation.
- [ ] Implement owner-scoped text records, versioned recovery summaries and record inspection/deletion.
- [ ] Implement conversational Router LLM delegation, task progress, explicit pause/resume and resource deadlines.
- [ ] Update web and mobile controls; separate single dictation from tap-to-start conversation.
- [ ] Add Router composite voice upstream, authorized user grants, capabilities and layered usage.
- [ ] Validate native/composite protocol subset and external SDK behavior.
- [ ] Run full regression, typecheck/build and real browser/mobile/host/Bluetooth acceptance.

## Verification and rollout

Each implementation unit gets its own validated commit. Keep unvalidated transports/models gated. Capture failed acceptance and unresolved requirements explicitly; never mark planned behavior as shipped. No automatic push, PR, deploy or version bump.

Cross-client records append independently. Current pending-slot tracking must be replaced only after verifying dsh event correlation; a map alone does not establish ownership. Reconnects query stable requests and do not replay historical speech.
