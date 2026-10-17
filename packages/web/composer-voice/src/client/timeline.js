import React from "react";
import { projectVoiceRecords, mergeVoiceTranscript, activeVoiceReply } from "@olares/lares-core/voice/projection";
import { useVoiceHistory } from "./history.js";
import { useT, messageFor } from "./locale.js";
const h = React.createElement;
export function VoiceTimeline({ panel, sessionId, nativeRows, entries, nodeStore, useChat, useConversation }) {
  const voice = React.useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const { records: history, error } = useVoiceHistory(sessionId); const t = useT();
  useChat((snapshot) => snapshot);
  const conversation = useConversation((snapshot) => snapshot);
  const nodes = nodeStore.values();
  const grouped = conversation.views.grouped("chat");
  const entryNodes = (entry) => entry?.kind === "group" ? (grouped?.groupSource(entry.key)?.getSnapshot()?.members || []).map((member) => nodeStore.get(member.key)).filter(Boolean) : [nodeStore.get(entry?.key)].filter(Boolean);
  const speaking = activeVoiceReply(history, voice.snapshot);
  const nativePlayback = mergeVoiceTranscript(nodes, history);
  const stop = () => h("button", { type: "button", className: "lares-voice-message-stop", onClick: () => { void panel.conversation?.controller.stopPlayback().catch(() => {}); } }, t("input.stopSpeaking"));
  const projected = projectVoiceRecords(history, nodes);
  const rows = nativeRows.map((element, index) => ({ element, index, entry: entries[index] }));
  const slots = rows.map(() => []); const head = [];
  for (const record of projected) {
    let at = -1;
    if (record.summary) {
      const target = nodes.find((node) => node.key === record.attachedTo);
      at = rows.findIndex(({ entry }) => entry?.key === record.attachedTo);
      if (at < 0 && target) at = rows.findLastIndex(({ entry }) => entryNodes(entry).some((node) => node.location?.turn?.turn === target.location?.turn?.turn));
    } else {
      at = rows.findLastIndex(({ entry }) => {
        const members = entryNodes(entry);
        return members.length && Math.max(...members.map((node) => node.anchorSeq)) <= record.anchorSeq;
      });
    }
    const message = h("div", { key: `voice:${record.id}`, className: "lares-voice-message", "data-role": record.role, "data-summary": record.summary ? "true" : undefined, "data-voice-id": record.id, "aria-busy": record.status === "streaming" }, record.text, record.id === speaking ? stop() : null);
    if (at >= 0) slots[at].push(message); else head.push(message);
  }
  return h(React.Fragment, null, ...head, ...rows.map(({ element, index }) => h(React.Fragment, { key: element.key || `native:${index}` }, element, ...slots[index], speaking && !projected.some(record => record.id === speaking) && entryNodes(rows[index].entry).some(node => nativePlayback.find(row => row.key === node.key)?.voicePlayback?.id === speaking) ? stop() : null)), error ? h("p", { role: "status" }, messageFor(t, error)) : null);
}
