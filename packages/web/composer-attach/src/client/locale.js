import { createLocaleBinding } from "../../../shared/client/locale-binding.js";
import { messageFromCode } from "@olares/lares-core/i18n/t";

export { ZH, EN } from "@olares/lares-core/i18n/files";

const binding = createLocaleBinding("lares.files");

export const attachLocale = binding.attach;
export const bindTranslate = binding.bind;
export const getTranslate = binding.getTranslate;
export const useT = binding.useT;

export function messageFor(t, code) {
  return messageFromCode(t, code, "error.file_upload_failed");
}
