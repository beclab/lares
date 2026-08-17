import React from "react";

const { useCallback, useSyncExternalStore } = React;

// dsh locale namespace; error keys mirror the Host error codes.
export const ZH = {
  "error.voice_permission_denied": "麦克风权限被拒绝",
  "error.voice_audio_too_large": "录音过长",
  "error.voice_audio_unreadable": "音频无法识别，请重录",
  "error.voice_model_unavailable": "语音模型不可用，请在设置里安装语音应用",
  "error.voice_timeout": "转写超时，请重试",
  "error.voice_too_short": "录音太短",
  "error.voice_no_input": "没有检测到声音",
  "error.voice_failed": "转写失败，请重试",
  "error.voice_unsupported": "当前浏览器不支持录音",
  "error.voice_identity_required": "Olares 身份尚未就绪：先通过 Olares 入口打开一次 Dina，再安装语音应用",
  "error.voice_catalog_failed": "读取 Router 模型目录失败",
  "error.voice_install_failed": "安装语音应用失败",
  "error.no_stt_app": "Router 模型目录中没有可安装的语音识别应用",
  "mic.stop": "点击结束录音",
  "mic.transcribing": "转写中…",
  "mic.idle": "语音输入",
  "mic.blocked": "当前无法输入",
  "lang.auto": "自动检测",
  "status.auto": "自动",
  "settings.title": "语音输入",
  "settings.intro": "在输入框旁点击麦克风录音，录完自动转写并填入文本。转写由 Olares Router 的语音模型提供。",
  "settings.status.ready": "语音就绪 · 模型 {model}",
  "settings.status.notReady": "语音模型尚不可用，请先安装语音应用",
  "settings.model.title": "语音模型",
  "settings.model.hint": "留空则自动选择目录中的语音模型",
  "settings.model.auto": "自动选择",
  "settings.language.title": "识别语言",
  "settings.language.hint": "指定语言可提升准确度与速度",
  "settings.saving": "保存中…",
  "settings.install": "安装语音应用",
  "settings.installing": "安装中…",
  "settings.saved": "已保存",
  "settings.saveFailed": "保存失败",
  "settings.preparing": "正在准备语音应用…",
  "settings.installFailed": "安装失败：{msg}",
  "install.ready": "语音模型已就绪：{model}",
  "install.started": "已开始安装 {app}，模型下载完成后自动可用",
};

export const EN = {
  "error.voice_permission_denied": "Microphone access denied",
  "error.voice_audio_too_large": "Recording too long",
  "error.voice_audio_unreadable": "Audio unreadable, please re-record",
  "error.voice_model_unavailable": "Voice model unavailable; install a voice app in Settings",
  "error.voice_timeout": "Transcription timed out, please retry",
  "error.voice_too_short": "Recording too short",
  "error.voice_no_input": "No voice detected",
  "error.voice_failed": "Transcription failed, please retry",
  "error.voice_unsupported": "This browser does not support recording",
  "error.voice_identity_required":
    "Olares identity not ready yet; open Dina once via the Olares entrance, then install the voice app",
  "error.voice_catalog_failed": "Failed to read the Router model catalog",
  "error.voice_install_failed": "Failed to install the voice app",
  "error.no_stt_app": "No installable speech-recognition app in the Router catalog",
  "mic.stop": "Click to stop recording",
  "mic.transcribing": "Transcribing…",
  "mic.idle": "Voice input",
  "mic.blocked": "Input unavailable",
  "lang.auto": "Auto-detect",
  "status.auto": "auto",
  "settings.title": "Voice input",
  "settings.intro":
    "Click the microphone beside the composer to record; the take is transcribed and inserted automatically. Transcription is served by an Olares Router voice model.",
  "settings.status.ready": "Voice ready · model {model}",
  "settings.status.notReady": "Voice model not available yet; install a voice app first",
  "settings.model.title": "Voice model",
  "settings.model.hint": "Leave empty to auto-pick a voice model from the catalog",
  "settings.model.auto": "Auto",
  "settings.language.title": "Recognition language",
  "settings.language.hint": "Specifying a language improves accuracy and speed",
  "settings.saving": "Saving…",
  "settings.install": "Install voice app",
  "settings.installing": "Installing…",
  "settings.saved": "Saved",
  "settings.saveFailed": "Failed to save",
  "settings.preparing": "Preparing the voice app…",
  "settings.installFailed": "Install failed: {msg}",
  "install.ready": "Voice model ready: {model}",
  "install.started": "Installing {app}; available automatically once the model download completes",
};

// Bound in apply once the locale service is injected; identity fallback before then.
let localeApi = null;
let translate = (key) => key;

/** Wire subscribe/snapshot before register; call bindTranslate after. */
export function attachLocale(api) {
  localeApi = api;
}

export function bindTranslate(api = localeApi) {
  translate = api.bind("dina.voice");
}

export function getTranslate() {
  return translate;
}

export function useT() {
  const subscribe = useCallback((fn) => (localeApi ? localeApi.subscribe(fn) : () => {}), []);
  const getRevision = useCallback(() => (localeApi ? localeApi.getSnapshot().revision : 0), []);
  useSyncExternalStore(subscribe, getRevision);
  return translate;
}

export function messageFor(t, code) {
  const key = `error.${code}`;
  const text = t(key);
  return text === key ? t("error.voice_failed") : text;
}
