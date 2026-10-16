/** Where a take is recorded. The desktop page uses the headset; the phone page uses its own mic. */
export function captureSource(surface, selected = "auto") {
  if (selected === "device" || selected === "headset") return selected;
  return surface === "mobile" ? "device" : "headset";
}
