/** Transport-neutral `lares-realtime-v1` client: the caller obtains an authenticated socket. */
export function createVoiceProtocolClient(socket, { onEvent = () => {}, onClose = () => {} } = {}) {
  // A command that does not reach the host fails the take. Progress ticks are
  // observations from the audio callback: drop them when the socket cannot take
  // them, and never throw. Completion, cancel and truncate are different: they
  // are what lets the host speak the next reply. Dropping them leaves the call
  // open and every later answer silent.
  const open = () => socket.readyState === 1 && socket.bufferedAmount <= 1024 * 1024;
  const send = (event) => {
    if (socket.readyState !== 1) throw new Error("voice_disconnected");
    if (socket.bufferedAmount > 1024 * 1024) throw new Error("voice_audio_backpressure");
    socket.send(JSON.stringify(event));
  };
  const observe = (event) => { if (open()) socket.send(JSON.stringify(event)); };
  const release = (event) => { if (socket.readyState === 1) socket.send(JSON.stringify(event)); };
  const message = (event) => {
    let value;
    try { value = JSON.parse(String(event.data)); } catch { onEvent({ type: "error", error: { code: "voice_protocol" } }); return; }
    if (value && typeof value.type === "string") onEvent(value);
  };
  const close = () => onClose();
  socket.addEventListener("message", message); socket.addEventListener("close", close);
  return {
    // Announcing playback acknowledgement up front keeps the first reply half-duplex too.
    configure({ type = "realtime", automatic = false, contextId, audio = true, busyTurn } = {}) {
      const input = { format: { type: "audio/pcm", rate: 24000 }, turn_detection: automatic ? { type: "server_vad" } : null };
      const lares = { ...(contextId ? { context_id: contextId } : {}), ...(busyTurn ? { busy_turn: busyTurn } : {}) };
      send({ type: "session.update", session: { type, ...(type === "realtime" ? { output_modalities: audio ? ["audio"] : ["text"], audio: { input, output: { format: { type: "audio/pcm", rate: 24000 } } } } : { audio: { input } }), ...(Object.keys(lares).length ? { lares } : {}) } });
      send({ type: "lares.playback.progress", item_id: null, played_ms: 0 });
    },
    append(audio) { if (typeof audio !== "string" || audio.length > 64000) throw new Error("voice_audio_limit"); send({ type: "input_audio_buffer.append", audio }); },
    commit() { send({ type: "input_audio_buffer.commit" }); },
    discard() { send({ type: "input_audio_buffer.clear" }); },
    say(text) { send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } }); },
    playbackProgress(itemId, playedMs) { observe({ type: "lares.playback.progress", item_id: itemId, played_ms: playedMs }); },
    playbackCompleted(itemId = null) { release({ type: "lares.playback.completed", item_id: itemId }); },
    stopOutput() { release({ type: "response.cancel" }); },
    truncate(itemId, audioEndMs) { release({ type: "conversation.item.truncate", item_id: itemId, content_index: 0, audio_end_ms: Math.max(0, Math.round(audioEndMs)) }); },
    setOutput(audio) { send({ type: "session.update", session: { output_modalities: [audio ? "audio" : "text"] } }); },
    setBusyTurn(mode) { send({ type: "session.update", session: { lares: { busy_turn: mode === "steer" ? "steer" : "queue" } } }); },
    deviceInput(active) { send({ type: active ? "lares.device.input.resume" : "lares.device.input.pause" }); },
    cancelTask(taskId) { send({ type: "lares.task.cancel", task_id: taskId }); },
    close() { socket.removeEventListener("message", message); socket.removeEventListener("close", close); socket.close(); },
  };
}
