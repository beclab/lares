export const DEVICE_MOBILE = "mobile";
export const DEVICE_DESKTOP = "desktop";
export const DESKTOP_CHAT_WIDTH_PX = 748;

/** Host-facing layout. Unknown values stay on the phone column. */
export function chatDevice(value) {
  return value === DEVICE_DESKTOP ? DEVICE_DESKTOP : DEVICE_MOBILE;
}
