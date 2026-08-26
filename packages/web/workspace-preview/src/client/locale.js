import { messageFromCode } from "@lares/core/i18n/t";

export { ZH, EN } from "@lares/core/i18n/preview";

export function errorMessage(t, code) {
  return messageFromCode(t, code, "error.file_preview_failed");
}
