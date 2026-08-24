import { createLocaleBinding } from "../../../shared/client/locale-binding.js";

export const ZH = {
  "button.idle": "添加图片或文件",
  "button.uploading": "正在上传 {count} 个文件…",
  "button.blocked": "当前无法添加文件",
  "error.file_too_large": "文件超过 100 MB",
  "error.file_empty": "不能上传空文件",
  "error.workspace_not_found": "当前会话没有可用工作区",
  "error.workspace_unavailable": "当前工作区不可用",
  "error.file_upload_failed": "文件上传失败，请重试",
};

export const EN = {
  "button.idle": "Add images or files",
  "button.uploading": "Uploading {count} file(s)…",
  "button.blocked": "File input unavailable",
  "error.file_too_large": "File exceeds 100 MB",
  "error.file_empty": "Empty files cannot be uploaded",
  "error.workspace_not_found": "No workspace is available for this session",
  "error.workspace_unavailable": "The current workspace is unavailable",
  "error.file_upload_failed": "File upload failed; please retry",
};

const binding = createLocaleBinding("lares.files");

export const attachLocale = binding.attach;
export const bindTranslate = binding.bind;
export const getTranslate = binding.getTranslate;
export const useT = binding.useT;

export function messageFor(t, code) {
  const key = `error.${code}`;
  const text = t(key);
  return text === key ? t("error.file_upload_failed") : text;
}
