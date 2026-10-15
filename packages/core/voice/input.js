/** Where a take is recorded. The desktop page uses the headset; the phone page uses its own mic. */
export function captureSource(surface) {
  return surface === "mobile" ? "device" : "headset";
}
