import { matchSpeechEvent, reduceUtterance } from "@olares/lares-core/voice/speech";

export const TARGET = "lares-voice-speech";

export const speechDefinition = {
  kind: TARGET,
  target: TARGET,
  match: matchSpeechEvent,
  start() {
    return { utterance: null };
  },
  update(context, match) {
    return { utterance: reduceUtterance(context.state?.utterance ?? null, match.event) };
  },
  buildViewNode(context) {
    const utterance = context.state?.utterance;
    if (!utterance?.text) return null;
    return {
      key: context.key,
      kind: context.kind,
      id: context.id,
      target: TARGET,
      data: utterance,
    };
  },
};

function later(a, b) {
  return a.turn !== b.turn ? a.turn > b.turn : a.step >= b.step;
}

function latestUtterance(nodes) {
  let best = null;
  for (const node of nodes) {
    const data = node?.data;
    if (!data?.key) continue;
    if (!best || later(data, best)) best = data;
  }
  return best;
}

function sameUtterance(a, b) {
  return a?.key === b?.key && a?.text === b?.text && a?.done === b?.done && a?.silent === b?.silent;
}

export const speechView = {
  target: TARGET,
  create() {
    let snapshot = { latest: null };
    const publish = (latest) => {
      if (sameUtterance(snapshot.latest, latest)) return snapshot;
      snapshot = { latest };
      return snapshot;
    };
    return {
      empty: snapshot,
      replace({ nodes }) {
        return publish(latestUtterance(nodes));
      },
      apply({ upserts }) {
        return publish(latestUtterance(upserts) ?? snapshot.latest);
      },
    };
  },
};
