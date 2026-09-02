import assert from "node:assert/strict";
import test from "node:test";
import { chatDevice, DESKTOP_CHAT_WIDTH_PX, DEVICE_DESKTOP, DEVICE_MOBILE } from "../../packages/mobile/src/layout.js";

test("chatDevice keeps the phone column unless the host passes desktop", () => {
  assert.equal(chatDevice("mobile"), DEVICE_MOBILE);
  assert.equal(chatDevice(undefined), DEVICE_MOBILE);
  assert.equal(chatDevice(""), DEVICE_MOBILE);
  assert.equal(chatDevice("tablet"), DEVICE_MOBILE);
  assert.equal(chatDevice("desktop"), DEVICE_DESKTOP);
  assert.equal(DESKTOP_CHAT_WIDTH_PX, 748);
});
