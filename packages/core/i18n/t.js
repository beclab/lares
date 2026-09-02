export function interpolate(template, params = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, name) =>
    params[name] == null ? `{${name}}` : String(params[name]),
  );
}

function langOf(locale) {
  const tag = String(locale ?? "en").toLowerCase();
  return tag === "zh" || tag.startsWith("zh") ? "zh" : "en";
}

export function t(catalog, locale, key, params) {
  const table = catalog[langOf(locale)] ?? catalog.en;
  const raw = table?.[key] ?? catalog.en?.[key] ?? key;
  return interpolate(raw, params);
}

export function messageFromCode(translate, code, fallbackKey) {
  const key = `error.${code}`;
  const text = translate(key);
  return text === key ? translate(fallbackKey) : text;
}
