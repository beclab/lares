let readout = null;
const readoutListeners = new Set();
export const readoutState = {
  getSnapshot: () => readout,
  subscribe(listener) { readoutListeners.add(listener); return () => readoutListeners.delete(listener); },
  publish(value) {
    readout = value ? { ...(readout?.key === value.key ? readout : {}), ...value } : null;
    for (const listener of readoutListeners) listener();
  },
};

/**
 * The utterance a turn may speak: the text of the step being written, read
 * while it streams. Only a step that ends without a tool call answers the
 * turn, and that is not known until the step settles, so a step turns silent
 * the moment a tool call shows up in it, and an interrupted step is silent
 * too. Reasoning is never read.
 */

function turnOf(event) {
  const data = event?.data ?? {};
  const turn = data.turn ?? data.message?.turn;
  const number = Number(turn);
  return Number.isFinite(number) ? number : null;
}

function stepOf(event) {
  const data = event?.data ?? {};
  const number = Number(data.step ?? data.message?.step);
  return Number.isFinite(number) ? number : 0;
}

function messageContent(event) {
  const data = event?.data ?? {};
  const content = data.message?.content ?? data.content;
  return Array.isArray(content) ? content : [];
}

export function assistantText(event) {
  return messageContent(event)
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isChunkEvent(event) {
  return event?.type === "assistant/chunk" || event?.type === "assistant/live-chunk";
}

function opensToolCall(chunk) {
  return chunk?.type === "tool-call-delta"
    || (chunk?.type === "block-start" && chunk.blockType === "tool-call")
    || (chunk?.type === "block-end" && chunk.block?.type === "tool-call");
}

function stepUtterance(turn, step) {
  return { key: `${turn}:${step}`, turn, step, blocks: {}, text: "", done: false, silent: false };
}

function withBlock(state, index, text) {
  const blocks = { ...state.blocks, [index]: text };
  const joined = Object.keys(blocks)
    .map(Number)
    .sort((a, b) => a - b)
    .map((at) => blocks[at].trim())
    .filter(Boolean)
    .join("\n");
  return { ...state, blocks, text: joined };
}

/**
 * @typedef {{ key: string, turn: number, step: number, text: string, done: boolean, silent: boolean }} Utterance
 * @param {Utterance | null} state
 * @returns {Utterance | null}
 */
export function reduceUtterance(state, event) {
  const type = event?.type;
  if (type === "turn/start") return null;
  if (type === "turn/end") {
    if (state && state.turn !== turnOf(event)) return state;
    const failed = ["error", "cancelled"].includes(event.data?.reason?.kind);
    return state ? { ...state, done: true, silent: state.silent || failed } : state;
  }
  const turn = turnOf(event);
  if (turn === null) return state;
  const step = stepOf(event);
  if (state && (turn < state.turn || turn === state.turn && step < state.step)) return state;
  const same = state?.turn === turn && state.step === step && (!event.data?.attemptId || state.attemptId === event.data.attemptId);
  if (isChunkEvent(event)) {
    if (same && state.done) return state;
    const chunk = event.data?.chunk;
    let current = same ? state : { ...stepUtterance(turn, step), attemptId: event.data?.attemptId };
    if (Number.isInteger(event.data?.chunkIndex) && event.data.chunkIndex <= (current.chunkIndex ?? -1)) return current;
    if (Number.isInteger(event.data?.chunkIndex)) current = { ...current, chunkIndex: event.data.chunkIndex };
    if (opensToolCall(chunk)) return current.silent ? current : { ...current, silent: true };
    const index = Number.isInteger(chunk?.index) ? chunk.index : 0;
    if (chunk?.type === "text-delta" && typeof chunk.text === "string") {
      return withBlock(current, index, `${current.blocks[index] ?? ""}${chunk.text}`);
    }
    if (chunk?.type === "block-end" && chunk.block?.type === "text" && typeof chunk.block.text === "string") {
      return withBlock(current, index, chunk.block.text);
    }
    return state;
  }
  if (type === "assistant/message") {
    const content = messageContent(event);
    return {
      ...stepUtterance(turn, step),
      text: assistantText(event),
      messageId: event.data?.message?.id ?? event.data?.messageId,
      attemptId: same ? state.attemptId : undefined,
      done: true,
      silent: Boolean(event.data?.interrupted) || content.some((block) => block?.type === "tool-call"),
    };
  }
  return state;
}

export function matchSpeechEvent(event) {
  const type = event?.type;
  if (type !== "turn/start" && type !== "turn/end" && type !== "assistant/message" && !isChunkEvent(event)) return null;
  const turn = turnOf(event);
  if (turn === null) return null;
  return { id: String(turn), role: type === "turn/start" ? "start" : "update" };
}

/**
 * Which utterances a live view reads aloud: only those it watched being
 * written while their turn was running. Opening a session mid-answer, or
 * history that is already finished, stays silent.
 */
export function createReplySpeaker() {
  let armed = false;
  let skipKey = null;
  return {
    /** @returns {Utterance | null} the utterance to follow now, or null */
    observe({ sessionChanged, wasRunning, running, utterance }) {
      if (sessionChanged) {
        armed = Boolean(running);
        skipKey = utterance?.key ?? null;
        return null;
      }
      if (!wasRunning && running) {
        armed = true;
        skipKey = utterance?.key ?? null;
      }
      const follow = armed && utterance && utterance.key !== skipKey ? utterance : null;
      if (!running) armed = false;
      return follow;
    },
  };
}

/**
 * Which state of an utterance the reader gets. Streaming reads while the step
 * is written; otherwise the step is read once it has settled.
 * @param {Utterance | null} utterance
 */
export function speakable(utterance, streaming) {
  if (!utterance) return null;
  return streaming || utterance.done || utterance.silent ? utterance : null;
}

/** Text past this may have closed a sentence; the host decides whether it did. */
const BOUNDARY = /[.!?;。！？；…\n]/;

/**
 * Reads one utterance at a time, sentence by sentence, while it is still being
 * written. The host owns sentence boundaries (sentencex does not run in a
 * page): the text is handed over whenever it may have finished a sentence, and
 * the host answers how many sentences are complete. That keeps a headset
 * reading on without gaps; the page fetches a sentence's audio just before it
 * needs it and plays it through `play`.
 *
 * `halt` stops the page's own audio. `silence` also stops the host, for a step
 * that turned out to call a tool while the headset was reading it.
 *
 * @param {{
 *   send: (request: { key: string, text: string, done: boolean, part?: number }) => Promise<any>,
 *   play: (sentence: { audio: unknown, bluetooth?: string }) => Promise<unknown>,
 *   halt: () => void,
 *   silence: () => void,
 *   fail?: (err: unknown) => void,
 * }} io
 */
export function createSentencePlayer({ send, play, halt, silence, fail = () => {}, onState = () => {}, onOutput = readoutState.publish, stream }) {
  let gen = 0;
  let current = null;
  // An utterance is read once: finishing it, failing, or being stopped all end it for good.
  let lastKey = null;
  let silencedKey = null;
  const consumed = new Set();
  const mutedTurns = new Set();
  let lastTurn = null;
  const turnKey = (value) => Number.isFinite(value.turn) ? `${value.sessionId ?? ""}:${value.turn}` : null;
  const mark = (set, key) => { if (key != null) set.add(key); };

  const emitOutput = value => {
    if (value || readoutState.getSnapshot()?.key === lastKey || onOutput !== readoutState.publish) onOutput(value);
  };
  const failed = (run, err) => {
    if (run.gen !== gen) return;
    run.abort?.abort();
    gen += 1;
    run.wake?.();
    current = null;
    onState(false); emitOutput(null);
    if (!["voice_cancelled", "voice_output_owned"].includes(err?.code || err?.message)) { emitOutput({ ...run.identity, status: "error", error: err?.code || err?.message || "voice_playback_failed", stop: () => emitOutput(null) }); fail(err); }
  };

  const handOver = (run) => {
    if (stream || run.sending || run.gen !== gen) return;
    const due = (run.done && !run.sentDone) || BOUNDARY.test(run.text.slice(run.sentLength));
    if (!due) return;
    const { text, done } = run;
    run.sending = send({ key: run.key, text, done })
      .then((result) => {
        run.sending = null;
        run.sent = Math.max(run.sent, Number(result?.sentences) || 0);
        run.sentLength = text.length;
        run.sentDone = done;
        const wake = run.wake;
        run.wake = null;
        wake?.();
        handOver(run);
      })
      .catch((err) => failed(run, err));
  };

  const fetchPart = (run, part) => {
    const pending = send({ key: run.key, text: run.text, done: run.done, part });
    pending.catch(() => {});
    return pending;
  };

  const read = async (run) => {
    if (stream) {
      await stream({ key: run.key, text: run.text, source: run.source, signal: run.abort.signal, controls: (value) => { if (run.gen === gen) run.controls = value; }, onStatus: (status) => { if (run.gen === gen) { if (status === "playing") onState(true); emitOutput({ key: run.key, status }); } } });
      if (run.gen === gen) { current = null; onState(false); emitOutput(null); }
      return;
    }
    let next = null;
    for (let part = 0; run.gen === gen;) {
      if (part >= run.sent) {
        if (run.sentDone) break;
        await new Promise((resolve) => { run.wake = resolve; });
        continue;
      }
      const sentence = await (next ?? fetchPart(run, part));
      next = part + 1 < run.sent ? fetchPart(run, part + 1) : null;
      if (run.gen !== gen) return;
      await play(sentence);
      part += 1;
    }
    if (run.gen === gen) { current = null; onState(false); emitOutput(null); }
  };

  const stop = () => {
    gen += 1;
    current?.abort?.abort();
    current?.wake?.();
    if (current) halt();
    current = null;
    onState(false); emitOutput(null);
  };

  return {
    /** Feed the latest state of the utterance; null leaves the reading as it is. */
    follow(utterance) {
      if (!utterance) return;
      if (utterance.silent) {
        if (utterance.key !== lastKey || silencedKey === lastKey) return;
        silencedKey = lastKey;
        stop();
        silence();
        return;
      }
      if (!utterance.text) return;
      const identity = turnKey(utterance);
      if (identity && mutedTurns.has(identity)) return;
      // A later tool call can invalidate uncommitted assistant text.
      if (stream && !utterance.done && !utterance.source) return;
      if (current?.key !== utterance.key) {
        if (consumed.has(utterance.key)) return;
        if (current) { mark(mutedTurns, lastTurn); stop(); }
        gen += 1;
        lastKey = utterance.key; lastTurn = identity; mark(consumed, lastKey);
        current = {
          gen,
          abort: new AbortController(),
          key: utterance.key,
          source: utterance.source,
          text: utterance.text,
          done: utterance.done,
          sent: 0,
          sentLength: 0,
          sentDone: false,
          sending: null,
          wake: null,
        };
        current.identity = utterance;
        const run = current;
        onState(true); emitOutput({ ...utterance, status: "preparing", stop: () => { mark(mutedTurns, lastTurn); stop(); silence(); } });
        handOver(run);
        read(run).catch((err) => failed(run, err));
        return;
      }
      current.text = utterance.text;
      current.done = utterance.done;
      handOver(current);
    },
    get key() { return current?.key; },
    get canPause() { return current?.controls?.canPause === true; },
    pause() { if (!current?.controls?.canPause) return false; current.controls.pause(); emitOutput({ key: current.key, status: "confirming" }); return true; },
    resume() { if (!current?.controls?.canPause) return false; current.controls.resume(); emitOutput({ key: current.key, status: "playing" }); return true; },
    stop() {
      mark(mutedTurns, lastTurn);
      stop();
      silence();
    },
  };
}
