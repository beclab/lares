import { t as translate } from "@olares/lares-core/i18n/t";
import { EN, ZH } from "@olares/lares-core/i18n/mobile";
import { EN as PREVIEW_EN, ZH as PREVIEW_ZH } from "@olares/lares-core/i18n/preview";
import { EN as FILES_EN, ZH as FILES_ZH } from "@olares/lares-core/i18n/files";
import { EN as VOICE_EN, ZH as VOICE_ZH } from "@olares/lares-core/i18n/voice";
import { EN as MODEL_EN, ZH as MODEL_ZH } from "@olares/lares-core/i18n/chat-model-switch";

const catalog = {
  zh: { ...PREVIEW_ZH, ...FILES_ZH, ...VOICE_ZH, ...MODEL_ZH, ...ZH },
  en: { ...PREVIEW_EN, ...FILES_EN, ...VOICE_EN, ...MODEL_EN, ...EN },
};

export function createT(locale) {
  return (key, params) => translate(catalog, locale, key, params);
}
