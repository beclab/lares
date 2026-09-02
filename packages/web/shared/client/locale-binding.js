import React from "react";

const { useCallback, useSyncExternalStore } = React;

export function createLocaleBinding(namespace) {
  let localeApi = null;
  let translate = (key) => key;

  return {
    attach(locale) {
      localeApi = locale;
    },
    bind(locale = localeApi) {
      translate = locale.bind(namespace);
    },
    getTranslate() {
      return translate;
    },
    useT() {
      const subscribe = useCallback((fn) => (localeApi ? localeApi.subscribe(fn) : () => {}), []);
      const getRevision = useCallback(() => (localeApi ? localeApi.getSnapshot().revision : 0), []);
      useSyncExternalStore(subscribe, getRevision, getRevision);
      return translate;
    },
  };
}
