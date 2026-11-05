import assert from "node:assert/strict";
import test from "node:test";
import { echoVerdict } from "@olares/lares-core/voice/echo";

const SAID_ZH = "你好！我是Reachy Mini，有什么可以帮你的吗？";
const SAID_EN = "Hi there! I'm Reachy Mini, a small robot here to help you today.";

test("the reply heard back through the microphone is echo, even mis-recognised", () => {
  assert.equal(echoVerdict("我是Reachy Mini，有什么可以", SAID_ZH), "echo");
  assert.equal(echoVerdict("我是瑞奇迷你有什么可以帮你的", SAID_ZH), "echo");
  assert.equal(echoVerdict("Reachy Mini a small robot here", SAID_EN), "echo");
});

test("a person talking over the reply is a person", () => {
  assert.equal(echoVerdict("帮我把灯关了", SAID_ZH), "person");
  assert.equal(echoVerdict("what time is it", SAID_EN), "person");
  // Words from the reply in another order are still a person.
  assert.equal(echoVerdict("help you robot small", SAID_EN), "person");
});

test("one or two words decide only when the reply never said them", () => {
  assert.equal(echoVerdict("停", SAID_ZH), "person");
  assert.equal(echoVerdict("stop", SAID_EN), "person");
  assert.equal(echoVerdict("你好", SAID_ZH), null);
  assert.equal(echoVerdict("你好", SAID_ZH, true), "echo");
  assert.equal(echoVerdict("", SAID_ZH), null);
  assert.equal(echoVerdict("", SAID_ZH, true), "echo");
});
