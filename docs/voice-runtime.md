# Voice runtime

Target architecture and lifecycle contracts: [Voice service design](voice-service-design.md). Delivery status: [implementation plan](voice-service-plan.md). The sections below describe current implementation, not completion of that design.

Lares owns the Agent, task history, tools, skills and approvals through dsh. Voice transports never execute business tools directly. This implementation takes lifecycle and streaming ideas from LiveKit without installing its Agent runtime.

## Modes

- **Single recording** currently submits a valid transcript to the bound dsh session. The target design changes this to editable draft insertion; see the delivery plan.
- **Continuous conversation** repeats capture, task execution and playback until explicitly stopped. It enables speech for that connection without changing other conversations.
- **Realtime** uses Router's compatible Realtime WebSocket protocol. The speech model delegates business work through the single `ask_lares` tool. Its `status` operation checks the current task without submitting another prompt.

Browser audio uses the device microphone and speaker. Host audio uses the existing Olares audio helper and an exclusive lease. The default remains host audio on desktop and device audio on mobile; Settings can override it. All shipped device adapters currently advertise **no validated voice barge-in**. They wait for playback and offer an explicit stop-speaking action. No hardware has been certified for simultaneous speech interruption by this change.

## Ownership and state

`voice/controller` has independent connection, capture, Agent and playback state. Input, output and Agent ports are injected. Both UI surfaces use `voice/conversation`; Realtime uses the same controller with PCM ports.

Each connection gets an opaque ID carried in `x-lares-voice-id`. Host state is additionally partitioned by the authenticated Olares user. Device selection is carried in `x-lares-voice-device`. These are correlation headers within Lares's existing platform authentication boundary, not a new authentication system. Lares remains a per-user application; the voice API does not introduce multi-tenant hosting.

A connection binds one existing dsh session or creates one after its first valid transcript. Capture fixes that binding before asynchronous work. Switching sessions closes the old voice connection. A user can stop recording, stop speaking, cancel the dsh task, or close voice independently. Closing voice never cancels the durable task.

Agent follow is established before prompt submission. Request IDs are retained on unknown outcomes and deduplicated by dsh. Resuming refreshes the existing task's state and does not submit its input again. Completed history and opening snapshots stay silent. Pending approvals remain in the ordinary Lares UI.

The Host registers spoken-answer guidance only for the active voice session. It does not toggle a global persona or replace a session's preset, skills or tool permissions.

## Host endpoints

All endpoints use the existing Lares Host authentication and CORS rules under `/api/lares/voice`:

| Endpoint | Purpose |
| --- | --- |
| `POST /session` | Bind an existing session or prepare lazy creation |
| `GET /session` | Current bound session, execution state and reply revision |
| `POST /session/prompt` | Submit text with a stable request ID and queue/steer mode |
| `POST /session/resume` | Reattach the observer without replaying a prompt |
| `POST /session/cancel` | Explicitly request task cancellation |
| `POST /session/close` | Release voice resources, preserving the task |
| `GET /playback/status` | Scoped synthesis/playback lifecycle |
| `POST /session/metric` | Bounded, allowlisted duration metrics |
| `POST /realtime/ticket` | Issue a single-use, 30-second WebSocket ticket |
| `GET /realtime` (upgrade) | Realtime audio/event connection |

Existing capture and speech routes now use scoped connection headers. TTS synthesis stays at most two requested parts ahead. Host FIFO writes apply backpressure, and playback completion is confirmed before listening restarts. A host helper upgrade is required for its new `playback-status` command; an older helper produces an explicit upgrade-required error.

## Realtime rollout

Configure `realtimeModel` from the Router catalog in Voice settings. Realtime models must advertise `mode=realtime`; names alone are not capability evidence.

Realtime stays unavailable until the operator sets both:

```sh
LARES_VOICE_REALTIME_ENABLED=1
LARES_VOICE_REALTIME_VALIDATED_MODELS=<exact catalog model ID>
```

The allowlist records actual validation, not model discovery. Leave it empty until the model, tools and intended devices pass the checklist below. Pipeline mode remains independently selectable.

The Host connects to Router using the existing application identity or configured Router key. A short-lived ticket is exchanged via `lares-ticket.<ticket>` in the WebSocket subprotocol list; only `lares-voice` is selected in the response. LarePass's platform authentication protocol is retained. Browsers receive no Router or provider key.

The model cannot choose a task session, workspace, preset, permissions or extra tools. Client events are restricted to audio input, cancellation and validated truncation of the current audio item. Queue limits close a stalled connection rather than accumulate unbounded audio. Provider call IDs are deduplicated, including unknown task outcomes. A timed-out tool wait returns `pending`; checking progress uses `status`, not another `run`.

Realtime captions are transient voice presentation. dsh stores the delegated tasks and results. The entire voice conversation is not replayed into task history.

## Verification

Run:

```sh
node --import tsx --test tests/plugins/voice-*.test.ts
npm run typecheck
npm run build
```

The tests cover binding, stale recognition, independent cancellation, exclusive device leases, task completion versus acceptance, history silence, prompt deduplication, pending/unknown task outcomes, PCM conversion, actual local WebSocket negotiation, one-use tickets and client injection rejection.

Before enabling Realtime or declaring hardware support, validate with actual devices and a real model:

1. Complete multiple turns on a browser microphone, host audio and Bluetooth headset.
2. Confirm speaker output does not become another user task; stop-speaking releases output before new capture.
3. Switch sessions while recognition or synthesis is pending and verify no cross-session result.
4. Disconnect and reconnect during a tool call; verify one task and no historical playback.
5. Exercise a task requiring approval and a failing tool. Voice must neither auto-approve nor claim success.
6. Test a long answer and a slow output device; queues remain bounded and stop clears pending audio.
7. Measure recognition, Agent first text, synthesis first audio and interruption duration. Metrics omit recognized text, source audio and credentials.

A real local Lares Host/dsh instance was also exercised against a simulated Router through lazy session creation, prompt submission, streamed result collection and connection closure.

Local simulated tests and a browser settings/layout check do not replace this hardware/model checklist. This implementation does not certify voice barge-in, deploy to Olares, or enable Realtime in a running installation.
