import { createLocaleBinding } from "../../../shared/client/locale-binding.js";

export { ZH, EN } from "@lares/core/i18n/search";

const binding = createLocaleBinding("lares.webSearch");

export const attachLocale = binding.attach;
export const bindTranslate = binding.bind;
export const getTranslate = binding.getTranslate;
export const useT = binding.useT;
