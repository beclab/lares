/**
 * The utterance a turn may speak: the text of the assistant message that
 * concludes it. The agent loop stops stepping once a settled message carries
 * no tool call, so that message is the answer even while turn-stopping work
 * still holds the turn open. Reasoning and text said alongside a tool call
 * are intermediate and stay silent.
 */

function turnOf(event) {
  const data = event?.data ?? {};
  const turn = data.turn ?? data.message?.turn;
  const number = Number(turn);
  return Number.isFinite(number) ? number : null;
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

/** The answer text when this event concludes its turn, otherwise "". */
export function concludingReply(event) {
  if (event?.type !== "assistant/message" || event.data?.interrupted) return "";
  if (messageContent(event).some((block) => block?.type === "tool-call")) return "";
  return assistantText(event);
}

/**
 * Which concluded answers a live view reads aloud: only those it watched
 * arrive while their turn was running. Opening a session, or history that is
 * already finished, stays silent.
 */
export function createReplySpeaker() {
  let armed = false;
  let spokenSeq = -1;
  return {
    /** @returns {string} text to speak now, or "" */
    observe({ sessionChanged, wasRunning, running, reply }) {
      if (sessionChanged) {
        armed = Boolean(running);
        spokenSeq = reply?.seq ?? -1;
        return "";
      }
      if (!wasRunning && running) {
        armed = true;
        // A turn start resets the reply, so one already here was loaded with
        // history, not watched.
        if (reply) spokenSeq = Math.max(spokenSeq, reply.seq);
      }
      let text = "";
      if (armed && reply && reply.seq > spokenSeq) {
        spokenSeq = reply.seq;
        text = reply.text;
      }
      if (!running) armed = false;
      return text;
    },
  };
}

export function emptySpeechState() {
  return { text: "", seq: -1 };
}

/**
 * A steer that lands after the answer runs another step in the same turn, so
 * a turn may conclude more than once; `seq` tells the answers apart.
 * @param {{ text: string, seq: number }} state
 */
export function reduceSpeechEvent(state, event) {
  const current = state ?? emptySpeechState();
  if (event?.type === "turn/start") return emptySpeechState();
  const text = concludingReply(event);
  return text ? { text, seq: Number(event.seq) } : current;
}

export function matchSpeechEvent(event) {
  const type = event?.type;
  if (type !== "turn/start" && type !== "assistant/message") return null;
  const turn = turnOf(event);
  if (turn === null) return null;
  return { id: String(turn), role: type === "turn/start" ? "start" : "update" };
}
