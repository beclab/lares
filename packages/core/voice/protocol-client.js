/** Transport-neutral client: the caller obtains an authenticated Router socket. */
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
    configure({ automatic = false, contextId, audio = true } = {}) { send({ type: "session.update", session: { type: "realtime", output_modalities: audio ? ["audio"] : ["text"], ...(contextId ? { voice_context_id: contextId } : {}), audio: { input: { format: { type: "audio/pcm", rate: 24000 }, turn_detection: automatic ? { type: "server_vad" } : null }, output: { format: { type: "audio/pcm", rate: 24000 } } } }); },
    append(audio) { if (typeof audio !== "string" || audio.length > 64000) throw new Error("voice_audio_limit"); send({ type: "input_audio_buffer.append", audio }); },
    commit() { send({ type: "input_audio_buffer.commit" }); },
    discard() { send({ type: "input_audio_buffer.clear" }); },
    playbackCompleted() { send({ type: "voice.playback.completed" }); },
    stopOutput() { send({ type: "response.cancel" }); },
    close() { socket.removeEventListener("message", message); socket.removeEventListener("close", close); socket.close(); },
  };
}
