export const VOICE_AUTO = "auto";
export const STT_LANGUAGE_CHOICES = [
  { id: "zh", label: "中文" },
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
  { id: "ko", label: "한국어" },
];

export function voiceMenuValue(stored) {
  return stored || VOICE_AUTO;
}

export function voiceValueFromMenu(id) {
  return id === VOICE_AUTO ? "" : id;
}

export const EMPTY_VOICE_CONFIG = { model: "", ttsModel: "", language: "", speak: false, streaming: false };

export function voiceChoiceItems(ids) {
  return ids.map((id) => ({ id, label: id }));
}

/** Stored choice when it is still listed, otherwise the first available model. */
export function selectedVoice(stored, ids) {
  if (stored && ids.includes(stored)) return stored;
  return ids[0] ?? "";
}

export function voiceLanguageItems(autoLabel) {
  return [{ id: VOICE_AUTO, label: autoLabel }, ...STT_LANGUAGE_CHOICES];
}

export function voiceModelItems(sttIds, autoLabel) {
  return [{ id: VOICE_AUTO, label: autoLabel }, ...sttIds.map((id) => ({ id, label: id }))];
}