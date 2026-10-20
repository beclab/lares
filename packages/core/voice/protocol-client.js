/** Transport-neutral `lares-realtime-v1` client: the caller obtains an authenticated socket. */
export function createVoiceProtocolClient(socket, { onEvent = () => {}, onClose = () => {} } = {}) {
  const send = (event) => {
    if (socket.readyState !== 1) throw new Error("voice_disconnected");
    if (socket.bufferedAmount > 1024 * 1024) throw new Error("voice_audio_backpressure");
    socket.send(JSON.stringify(event));
  };
  const message = (event) => {
    let value;
    try { value = JSON.parse(String(event.data)); } catch { onEvent({ type: "error", error: { code: "voice_protocol" } }); return; }
    if (value && typeof value.type === "string") onEvent(value);
  };
  const close = () => onClose();
  socket.addEventListener("message", message); socket.addEventListener("close", close);
  return {
    // Announcing playback acknowledgement up front keeps the first reply half-duplex too.
    configure({ automatic = false, contextId, audio = true, busyTurn } = {}) {
      send({ type: "session.update", session: { type: "realtime", output_modalities: audio ? ["audio"] : ["text"], audio: { input: { format: { type: "audio/pcm", rate: 24000 }, turn_detection: automatic ? { type: "server_vad" } : null }, output: { format: { type: "audio/pcm", rate: 24000 } } }, ...(contextId || busyTurn ? { lares: { ...(contextId ? { context_id: contextId } : {}), ...(busyTurn ? { busy_turn: busyTurn } : {}) } } : {}) } });
      send({ type: "lares.playback.progress", item_id: null, played_ms: 0 });
    },
    append(audio) { if (typeof audio !== "string" || audio.length > 64000) throw new Error("voice_audio_limit"); send({ type: "input_audio_buffer.append", audio }); },
    commit() { send({ type: "input_audio_buffer.commit" }); },
    discard() { send({ type: "input_audio_buffer.clear" }); },
    say(text) { send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } }); },
    playbackProgress(itemId, playedMs) { send({ type: "lares.playback.progress", item_id: itemId, played_ms: playedMs }); },
    playbackCompleted(itemId = null) { send({ type: "lares.playback.completed", item_id: itemId }); },
    stopOutput() { send({ type: "response.cancel" }); },
    cancelTask(taskId) { send({ type: "lares.task.cancel", task_id: taskId }); },
    close() { socket.removeEventListener("message", message); socket.removeEventListener("close", close); socket.close(); },
  };
}
