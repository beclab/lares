import { createLocaleBinding } from "../../../shared/client/locale-binding.js";

export { ZH, EN } from "@olares/lares-core/i18n/skills";

const binding = createLocaleBinding("lares.skills");

export const attachLocale = binding.attach;
export const bindTranslate = binding.bind;
export const getTranslate = binding.getTranslate;
export const useT = binding.useT;
