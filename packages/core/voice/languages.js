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

export const EMPTY_VOICE_CONFIG = { model: "", language: "" };

export function voiceLanguageItems(autoLabel) {
  return [{ id: VOICE_AUTO, label: autoLabel }, ...STT_LANGUAGE_CHOICES];
}

export function voiceModelItems(sttIds, autoLabel) {
  return [{ id: VOICE_AUTO, label: autoLabel }, ...sttIds.map((id) => ({ id, label: id }))];
}

export function voiceStatusReady(status) {
  return Boolean(status?.modelAvailable);
}
