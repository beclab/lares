export function parseAskUserQuestions(argsRaw) {
  let parsed;
  try {
    parsed = JSON.parse(String(argsRaw ?? ""));
  } catch {
    return [];
  }
  const list = Array.isArray(parsed?.questions) ? parsed.questions : [];
  return list.filter((item) => item && typeof item.id === "string" && typeof item.question === "string");
}

export function singleSelectAnswer(questionId, label) {
  return {
    answers: [{ id: String(questionId), selected: [String(label)] }],
  };
}
