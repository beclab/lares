import { messageFromCode } from "@olares/lares-core/i18n/t";

export { ZH, EN } from "@olares/lares-core/i18n/preview";

export function errorMessage(t, code) {
  return messageFromCode(t, code, "error.file_preview_failed");
}
