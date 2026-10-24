/**
 * Whether what ASR heard during a reply is that reply coming back through the microphone.
 *
 * A device without echo cancellation hears its own voice, and a speech model hears that as a
 * person. What tells them apart is the words: an echo says what the reply is saying. Tokens are
 * CJK characters and Latin words, compared as consecutive pairs so that a person who happens to
 * use the reply's words in another order is still a person.
 *
 * @param {string} heard ASR's text so far
 * @param {string} said what the device has been saying
 * @param {boolean} final no more text is coming; an undecided verdict is not allowed
 * @returns {"echo" | "person" | null} null while there are too few words to tell
 */
export function echoVerdict(heard, said, final = false) {
  const words = tokens(heard);
  if (!words.length) return final ? "echo" : null;
  const reply = tokens(said);
  if (words.length >= 3) {
    const known = new Set(pairs(reply));
    const mine = pairs(words);
    return mine.filter((pair) => known.has(pair)).length / mine.length >= ECHO_SHARE ? "echo" : "person";
  }
  // One or two words: a word the reply never said ("停", "stop") is a person straight away.
  const vocabulary = new Set(reply);
  if (words.some((word) => !vocabulary.has(word))) return "person";
  return final ? "echo" : null;
}

/** Share of heard word pairs the reply contains for the text to count as its echo. */
const ECHO_SHARE = 0.5;

function tokens(text) {
  return String(text || "").toLowerCase().match(/[㐀-鿿豈-﫿]|[\p{L}\p{N}']+/gu) || [];
}

function pairs(words) {
  return words.slice(1).map((word, i) => `${words[i]} ${word}`);
}
