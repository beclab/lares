import React from "react";

const { useCallback, useSyncExternalStore } = React;

export const ZH = {
  "settings.title": "网络搜索",
  "settings.intro": "保存前会自动测试，测试不通过不会保存。",
  "settings.default": "默认提供方",
  "settings.default.none": "未选择",
  "settings.default.empty": "请先保存一个提供方",
  "provider.tavily": "Tavily",
  "provider.custom": "自定义",
  "provider.apiKey": "API Key",
  "provider.url": "接口 URL",
  "provider.saved": "已保存",
  "provider.unsaved": "未保存",
  "settings.save": "保存",
  "settings.saving": "保存中…",
  "settings.saved": "已保存",
  "settings.saveFailed": "保存失败：{msg}",
  "settings.defaultFailed": "切换默认失败",
  "settings.test": "测试连接",
  "settings.testing": "测试中…",
  "settings.testOk": "连通正常（{ms} ms）{sample}",
  "settings.testFailed": "测试失败：{msg}",
  "loading": "加载中…",
};

export const EN = {
  "settings.title": "Web search",
  "settings.intro": "Saving runs a connection test first; a failing test is not saved.",
  "settings.default": "Default provider",
  "settings.default.none": "None",
  "settings.default.empty": "Save a provider first",
  "provider.tavily": "Tavily",
  "provider.custom": "Custom",
  "provider.apiKey": "API key",
  "provider.url": "Endpoint URL",
  "provider.saved": "Saved",
  "provider.unsaved": "Not saved",
  "settings.save": "Save",
  "settings.saving": "Saving…",
  "settings.saved": "Saved",
  "settings.saveFailed": "Save failed: {msg}",
  "settings.defaultFailed": "Failed to set default",
  "settings.test": "Test connection",
  "settings.testing": "Testing…",
  "settings.testOk": "Connected ({ms} ms){sample}",
  "settings.testFailed": "Test failed: {msg}",
  "loading": "Loading…",
};

let localeApi = null;
let translate = (key) => key;

export function attachLocale(locale) {
  localeApi = locale;
}

export function bindTranslate(locale) {
  translate = locale.bind("dina.webSearch");
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
