# Voice service design

Status: target design; capabilities become available only after implementation and acceptance. See [runtime](voice-runtime.md) for current behavior and [delivery plan](voice-service-plan.md) for progress.

## Boundaries

The service initially runs in the Lares process. Shared logic lives in `packages/core/voice`; Host adapters mount authenticated routes. No LiveKit Agent runtime is introduced. Lares/dsh owns durable tasks, skills, tools, approvals and business history. Router owns model discovery, authentication, routing, quotas and usage. SDKs own device capture, transport and playout reporting. Existing voice_input is not a mandatory dependency; its ordered transcript events, optional cleanup and capability negotiation are reference contracts.

```mermaid
flowchart LR
    UI["Lares web / mobile"] --> V["Voice service"]
    APP["IME / other callers"] --> ENTRY["Router voice entrance"]
    ENTRY --> V
    V --> MODELS["Router model entrance"]
    MODELS --> PIPE["ASR / LLM / TTS"]
    MODELS --> RT["Native Realtime"]
    V --> ADAPTER["Lares adapter"]
    ADAPTER --> DSH["dsh sessions / tasks / approvals"]
```

Public voice model IDs must differ from dependency model IDs. Reject recursive service routing. Provider-native Realtime and cascaded speech are separate backends, not separate user interaction modes.

## Interaction and presets

| Preset | Behavior |
| --- | --- |
| dictation | ASR and optional faithful cleanup; return text, never execute an Agent |
| chat | Speech conversation without Lares |
| assistant | Speech LLM handles conversation and clarification; business lookups/actions delegate to Lares |
| direct | Every valid transcript enters dsh; read its response if enabled |

Continuous conversation uses either Router ASR + LLM + TTS or a validated native Realtime model. Server presets control models, instructions, voice, language, endpointing, interruptions, read-aloud and timeouts. Clients may override only allowlisted values. Business session/workspace/preset/tool permissions come from authenticated grants, never model arguments.

Web defaults to dictation, mobile to continuous conversation. A single composer entry follows the platform default; settings update its label and behavior. Dictation returns editable text, preserving existing text and attachments, and sends only on user confirmation. Conversation opens on a tap and uses hold-to-speak/release-to-submit turns. Read-aloud is independent of mode.

## Three lifecycles

An audio connection owns microphone, stream, playback and physical-device leases. A VoiceSession owns the live exchange, turn state, model connections and task associations. A Lares session owns persistent business history. IDs are correlation values, not credentials. Owner-scoped context handles permit explicit recovery across new VoiceSession IDs; they never replace user authorization. Transport recovery and business binding recovery are separate.

| Situation | VoiceSession | Lares session |
| --- | --- | --- |
| Next utterance during an active exchange | reuse | reuse |
| New device/client | independent | may explicitly share |
| Existing chat entry | create | bind selected chat |
| Standalone entry | create | lazy on first business delegation |
| Dictation / pure chat | lightweight / conversational | none |
| Explicit new chat | end and create | lazy new binding |
| Switch existing chat | stop old audio, discard unsubmitted input | bind target |
| Audio reconnect / backend rotation | resume or rebuild runtime | preserve |
| End and start again in same chat | new runtime | preserve |

```mermaid
stateDiagram-v2
    state "Off" as Off
    state "Authorize, bind, restore" as Prepare
    state "Active exchange" as Active
    state "Audio paused" as Paused
    state "Resources released" as Ended
    Off --> Prepare: explicit start
    Prepare --> Active: ready
    Active --> Active: follow-up / interrupt
    Active --> Paused: pause / background / disconnect
    Paused --> Active: explicit resume
    Active --> Ended: end / idle deadline
    Paused --> Ended: recovery deadline
    Ended --> Prepare: new VoiceSession
```

Defaults: 300 seconds exchange idle, 120 seconds reconnect grace; both configurable. Background/lock stops capture and playout. No automatic microphone restart or historical audio replay. Background business tasks must not keep audio/model resources alive. Closing voice never implicitly cancels dsh work. Pause input discards unsubmitted input but can leave output running; background/disconnect pauses both.

## Context and records

Keep speech text records separately from dsh task messages, with owner, source client, voice session, turn, task association and append order. Never persist raw audio by default. Store a recoverable summary of topic, constraints, unresolved clarification and tasks; checkpoint after each turn. Following a crash, rebuild from committed text. Summaries carry source/version and must not overwrite concurrent client updates blindly.

Resume with the relevant summary and current task state, not a replay of all business history. Ambiguous references require clarification. Records are inspectable/clearable and deleted with their parent conversation. Independent chat records have their own owner and lifecycle. Dictation text is returned to the caller rather than automatically added to assistant history.

## Delegation contract

```mermaid
sequenceDiagram
    participant U as User
    participant V as Voice service / speech LLM
    participant A as Lares adapter
    participant H as dsh Host
    U->>V: Spoken business request
    V->>A: ask_lares(task, stable request ID)
    opt No bound business session
        A->>H: create(authorized preset, workspace)
        H-->>A: sessionId
        A->>A: Save binding
    end
    A->>H: follow(sessionId)
    H-->>A: Subscription ready
    A->>H: prompt(sessionId, requestId, task)
    H-->>A: accepted (not completed)
    H-->>A: Request/turn-associated progress or approval
    A-->>V: Progress / waiting for user
    H-->>A: Final assistant message and turn end
    A-->>V: Actual task result
    V-->>U: Spoken answer based on result
```

Track each request and associated dsh turn; session idle alone is never completion evidence. Verify queue and steer semantics against the installed dsh event contract. Source user messages fence ownership; another client's turn must never be read as this client's result. Keep unknown submissions deduplicated; reconnection checks the original request instead of issuing it again. Pending, approval, failure, cancellation and completion are distinct states. Long-running work permits further speech and survives audio closure. Voice cannot approve on the user's behalf. Exactly one path speaks each result.

## Protocol and safety

Expose create/close, audio input, commit/discard turn, pause/resume input, stop output, playout acknowledgement and typed events. Exactly one endpointing authority controls a connection. Reuse VAD and configurable pause thresholds initially; retain a semantic detector port. Detect interruptions independently of end-of-turn. Truncate conversational output only at acknowledged playout, never at bytes merely received.

Retain bounded queues, host exclusive leases and capability-based half-duplex behavior. Automatic barge-in remains disabled until actual echo tests pass. No stream may accumulate unbounded buffered audio. The composite protocol requires explicit playout-completed acknowledgement before accepting more half-duplex input; response generation completion alone is insufficient.

Router exposure initially implements an advertised Realtime WebSocket subset plus capabilities. WebRTC, SIP and arbitrary client tools are excluded. Applications without an authenticated user grant may use authorized dictation/chat but cannot delegate to a personal Lares session. An app ID or client-supplied user/session ID does not establish end-user authority. Scoped records, resume handles and grants must reject cross-user access.

Attribute composite service usage separately from child model usage; do not fabricate native token counts or count the same cost twice. Gate unvalidated models and transports. Failure must remain explicit, with no silent downgrade/re-execution.

## Acceptance

Test stale input, cancellation, session switching, multi-client shared tasks, queue/steer correlation, approvals, deduplication across uncertain outcomes, context recovery, backpressure and identity isolation. Run focused/full tests, typecheck and build. Verify real browser, iOS/Android, host and Bluetooth chains separately; report transcription, first text, first audio and interruption latency without logging transcripts or credentials as metrics. No deployment, push, PR or release version change is implicit.

## Voice panel and session message presentation

The composer exposes one voice entry. Web defaults to dictation, mobile to conversation; each platform default is saved separately in Settings. Desktop uses a compact in-app panel and mobile a full-screen panel. Device, output and model preferences belong in Settings, not a row of panel controls.

Dictation starts immediately when the entry is opened with no retained draft. Recording shows waveform, elapsed time, any available partial transcript, and Done. Done ends capture and produces an editable preview. Insert appends to the original session draft without replacing text or attachments; Discard clears only this take. Close/Escape/backdrop stops capture and retains a draft without inserting or submitting it. Reopening a retained draft does not restart the microphone. Empty audio creates no task.

Conversation uses a manual turn policy: hold to capture, release to submit, slide up to discard. Replies appear in session messages and optionally play aloud. Holding during playback stops output before recording. Keyboard Space supports hold/release and Enter or assistive activation supports start/finish. Release during asynchronous microphone preparation cancels pending capture. No automatic endpoint or automatic re-listen runs for these turns; automatic SDK clients retain their existing policy. Closing pauses audio, preserves context and leaves dsh work running. Ending releases VoiceSession resources. Cancel task remains in native Chat.

### Dictation processing presets

Interaction references: [Typeless Dictate](https://www.typeless.com/help/quickstart/dictate) and [shortcut settings](https://www.typeless.com/help/quickstart/settings). Lares retains explicit editable preview/insertion as requested; outline/summary are Lares processing presets, not claims about Typeless preset names.

| Preset | Chain | Contract |
| --- | --- | --- |
| raw | Router ASR | Return the ASR text verbatim; zero LLM calls |
| clean (new-user default) | ASR → Router LLM | Remove fillers/repetition and apply explicit corrections, preserving meaning |
| outline | ASR → Router LLM | Organize this take into title/key points without adding facts |
| summary | ASR → Router LLM | Compress this take while preserving constraints and uncertainty |

Settings configure the ASR model, default dictation preset and separate LLM model/instructions for each non-raw preset. Built-in instructions can be restored. All processing has a fixed boundary: no tools, no execution or answering of spoken instructions; retain names, numbers, negation and uncertainty. Missing models and failures retain the raw text and expose retry/use-original actions. Legacy explicitly stored dictationCleanup maps false to raw and true to clean; an explicit new preset takes precedence and subsequent writes contain only the new configuration.

Preview supports manual editing and a compact preset selector. Reprocessing always uses the original transcript; replacing manual edits requires confirmation. A processing generation and AbortSignal fence stale results. Per-recording configuration snapshots fix the ASR and text profiles for that take. Raw audio is not newly persisted; the word dictionary and style learning are deferred.

Optional page-focused keyboard bindings can trigger default dictation or a specific preset; a second activation finishes recording. They never change defaults or start a concurrent capture while a preview is open. Repeated/composing key events, duplicate bindings and common browser conflicts are rejected. Native system-wide shortcuts require future desktop integration.

Existing Lares sessions bind directly. On an empty Lares page, the first valid continuous transcript creates a presentation session without submitting an Agent prompt. Empty audio, noise and cancellation create nothing. Generic Voice Service clients retain their own binding policy.

Voice user/assistant records are read-only projections alongside native dsh chat nodes (mobile Transcript uses the same projection rules). Records are persisted independently, never synthesized as dsh execution events or resubmitted as prompts. Streaming updates replace the same stable record ID. Host ordering and persisted dsh sequence anchors provide stable interleaving after refresh and across clients. Historical records never trigger speech. Session-scoped authorized paginated reads and subscriptions are independent of an active VoiceSession; /records alone is insufficient.

Delegations correlate voiceId / turnId / requestId / taskId. Native dsh input/results take over corresponding temporary projections; spoken summaries are attached to the task result. Tool progress, approvals and cancellation use native chat components. Core owns panel lifecycle, drafts, binding and projection; React/Vue own presentation and devices.

```mermaid
flowchart TD
    Entry[Single voice entry] --> Mode{Platform default}
    Mode -->|Dictation| Capture[Record until Done]
    Capture --> Preset{Processing preset}
    Preset -->|raw| Preview[Editable preview]
    Preset -->|clean / outline / summary| LLM[Router LLM without tools]
    LLM --> Preview
    Preview -->|Insert| Draft[Append to original composer draft]
    Preview -->|Discard| Clear[Clear take]
    Mode -->|Conversation| Hold[Hold to speak]
    Hold -->|Release| Bind[Bind session and submit valid turn]
    Hold -->|Slide up| Cancel[Discard take]
    Bind --> Reply[Persist / project actual reply and optionally play]
    Reply --> Hold
    Entry --> Close[Close pauses audio and retains context]
    Close --> Background[Existing dsh tasks continue]
```

The initial implementation uses bounded long polling for session history, stable record sequences for pagination, and a persisted `anchorSeq` for native dsh ordering. A read-only external activity marker expands the official Chat on voice-only sessions. Presentation markers and projected rows never become execution events. Client subscriptions share one web history feed per mounted session and stop when the last subscriber leaves.
