# Lares voice session handoff — 2026-10-19

## Checkout and completed units

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

## Remaining work for the next session

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
