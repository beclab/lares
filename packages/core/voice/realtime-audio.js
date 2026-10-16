/** Streaming rate conversion keeps fractional phase across device frames. */
export function createPcmResampler(inputRate, outputRate = 24000) {
  if (!(inputRate > 0 && outputRate > 0)) throw new Error("voice_audio_format");
  let position = 0;
  return (samples) => {
    const values = [];
    const step = inputRate / outputRate;
    for (; position < samples.length; position += step) {
      const i = Math.floor(position);
      const fraction = position - i;
      const value = samples[i] * (1 - fraction) + samples[Math.min(i + 1, samples.length - 1)] * fraction;
      values.push(Math.max(-1, Math.min(1, value)));
    }
    position -= samples.length;
    const bytes = new Uint8Array(values.length * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < values.length; i++) view.setInt16(i * 2, Math.round(values[i] * 32767), true);
    return bytes;
  };
}
export function pcmSamples(bytes) {
  if (bytes.length % 2) throw new Error("voice_audio_format");
  const values = new Float32Array(bytes.length / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < values.length; i++) values[i] = view.getInt16(i * 2, true) / 32768;
  return values;
}
function base64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function unbase64(value) { return Uint8Array.from(atob(value), (c) => c.charCodeAt(0)); }

export function createPcmBrowserAudio({ send, onPlayback = () => {}, onError = () => {} }) {
  let context;
  let stream;
  let source;
  let processor;
  let mute;
  let next = 0;
  let first = 0;
  let closed = true;
  let generation = 0;
  const players = new Set();
  const drains = new Set();
  const stopPlayback = () => {
    generation++;
    for (const player of players) { player.onended = null; player.stop(); player.disconnect(); }
    players.clear();
    next = context?.currentTime || 0;
    for (const resolve of drains) resolve();
    drains.clear();
    onPlayback(false);
  };
  return {
    async start() {
      const epoch = ++generation;
      closed = false;
      const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioCtx || !globalThis.navigator?.mediaDevices?.getUserMedia) throw new Error("voice_unsupported");
      const opened = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (closed || epoch !== generation) { opened.getTracks().forEach((track) => track.stop()); return; }
      stream = opened;
      for (const track of stream.getTracks()) track.addEventListener("ended", () => { if (!closed) onError(new Error("voice_device_lost")); }, { once: true });
      context ??= new AudioCtx(); await context.resume();
      source = context.createMediaStreamSource(stream);
      processor = context.createScriptProcessor(2048, 1, 1);
      mute = context.createGain(); mute.gain.value = 0;
      const convert = createPcmResampler(context.sampleRate);
      processor.onaudioprocess = (event) => {
        if (closed || players.size) return;
        send({ type: "input_audio_buffer.append", audio: base64(convert(event.inputBuffer.getChannelData(0))) });
      };
      source.connect(processor); processor.connect(mute); mute.connect(context.destination);
    },
    pauseInput() {
      generation++;
      if (processor) processor.onaudioprocess = null;
      source?.disconnect(); processor?.disconnect(); mute?.disconnect();
      source = null; processor = null; mute = null;
      stream?.getTracks().forEach((track) => track.stop()); stream = null;
    },
    write(value) {
      if (!context || closed) return;
      const samples = pcmSamples(unbase64(value));
      if (next - context.currentTime > 15) throw new Error("voice_audio_backpressure");
      const buffer = context.createBuffer(1, samples.length, 24000); buffer.copyToChannel(samples, 0);
      const player = context.createBufferSource(); player.buffer = buffer; player.connect(context.destination);
      if (!players.size) { first = context.currentTime; onPlayback(true); }
      players.add(player);
      player.onended = () => {
        players.delete(player); player.disconnect();
        if (!players.size) {
          for (const resolve of drains) resolve(); drains.clear(); onPlayback(false);
        }
      };
      next = Math.max(context.currentTime + 0.02, next); player.start(next); next += buffer.duration;
    },
    drain() { return players.size ? new Promise((resolve) => drains.add(resolve)) : Promise.resolve(); },
    playedMs() { return context ? Math.max(0, Math.floor((Math.min(context.currentTime, next) - first) * 1000)) : 0; },
    stopPlayback,
    async stop() {
      closed = true; stopPlayback();
      if (processor) processor.onaudioprocess = null;
      source?.disconnect(); processor?.disconnect(); mute?.disconnect();
      stream?.getTracks().forEach((track) => track.stop()); stream = null;
      await context?.close(); context = null;
    },
  };
}
