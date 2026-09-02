import { createLocaleBinding } from "../../../shared/client/locale-binding.js";

export { ZH, EN } from "@olares/lares-core/i18n/chat-model";

const binding = createLocaleBinding("lares.chat-model");

export const attachLocale = binding.attach;
export const bindTranslate = binding.bind;
export const getTranslate = binding.getTranslate;
export const useT = binding.useT;
