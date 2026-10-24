/**
 * Scenarios from the Reachy Mini voice trials on pptest03. Each one sets up a
 * dialogue exactly as the robot does — its persona, its tools, earlier turns and
 * task results — and checks what the dialogue model does with one utterance.
 * ask_lares is a stub here, so a passing run never touches a real device.
 */

// The robot's persona, shortened; the language line is the one that matters.
export const PERSONA = [
  "You are Reachy Mini: a friendly, compact robot assistant with a calm voice and a subtle sense of humor.",
  "You speak English by default and switch languages only if explicitly told.",
  "Respond in 1-2 sentences maximum. Keep responses under 25 words when possible.",
].join("\n");

const object = (properties = {}, required = []) => ({ type: "object", properties, required });
// The tools the robot declares by default (reachy_mini_conversation_app v1.1.1), with their own descriptions.
export const DEVICE_TOOLS = [
  { name: "dance", description: "Play a named or random dance move once (or repeat). Non-blocking.", parameters: object({ move: { type: "string", description: "Move name such as simple_nod, head_tilt_roll or random" }, repeat: { type: "integer" } }) },
  { name: "move_head", description: "Move your head in a given direction: left, right, up, down or front.", parameters: object({ direction: { type: "string", enum: ["left", "right", "up", "down", "front"] } }, ["direction"]) },
  { name: "play_emotion", description: "Play a robot emotion matching a requested emotional intent.", parameters: object({ emotion: { type: "string" } }, ["emotion"]) },
  { name: "camera", description: "Take a picture with the camera to see what is in front of the robot. Use this when the user asks you to look at something, see what they are holding, check their appearance, describe the scene.", parameters: object({ question: { type: "string" } }, ["question"]) },
  { name: "head_tracking", description: "Enable or disable following the user's face with the head.", parameters: object({ enabled: { type: "boolean" } }, ["enabled"]) },
  { name: "robot_status", description: "Read Reachy's own status: name, software, wifi, battery.", parameters: object({ topic: { type: "string" } }, ["topic"]) },
  { name: "pollen_robotics_reachy_mini_weather_tool__get_weather", description: "Get today's weather for a place: current conditions, high and low.", parameters: object({ location: { type: "string" } }, ["location"]) },
  { name: "pollen_robotics_reachy_mini_search_tool__search_web", description: "Search the web and return short results.", parameters: object({ query: { type: "string" } }, ["query"]) },
  { name: "pollen_robotics_reachy_mini_time_tool__get_time", description: "Get the current local time.", parameters: object() },
];

const CJK = /[㐀-鿿]/;
const FRENCH = /\b(je|vous|bonjour|pour|lumière|c'est|est-ce)\b/i;
export const language = (text) => CJK.test(text) ? "zh" : FRENCH.test(text) ? "fr" : /[a-z]/i.test(text) ? "en" : "none";

const delegated = (run) => run.delegations.length > 0;
const called = (run, ...names) => run.calls.some((call) => names.includes(call.name));
const speaks = (run, lang) => !run.text.trim() || language(run.text) === lang;
// A turn that errors is heard as "Voice operation failed", whatever it managed to do first; reasoning
// that leaks into the text is read aloud.
const check = (...rules) => (run) => [
  ...(run.error ? [`turn failed: ${run.error}`] : []),
  ...(/<\/?think>/.test(run.text) ? ["reasoning leaked into the reply"] : []),
  ...rules.map(([ok, why]) => (ok(run) ? null : why)).filter(Boolean),
];

export const SCENARIOS = [
  {
    id: "nod-zh",
    issue: "点点头 was lost, or ran through ask_lares",
    say: "点点头",
    expect: check([(run) => called(run, "dance", "move_head"), "no nod (dance / move_head)"], [(run) => !delegated(run), "sent a gesture to ask_lares"]),
  },
  {
    id: "light-on-zh",
    issue: "开灯 chose play_emotion and never reached ask_lares",
    say: "帮我开下灯",
    expect: check([delegated, "light request not sent to ask_lares"], [(run) => speaks(run, "zh"), "did not answer in Chinese"]),
  },
  {
    id: "light-off-en",
    issue: "English request answered in French",
    say: "Please turn off the light.",
    expect: check([delegated, "light request not sent to ask_lares"], [(run) => speaks(run, "en"), "did not answer in English"]),
  },
  {
    id: "camera-zh",
    issue: "Seeing what the user holds needs the camera",
    say: "看看我手上拿的是什么",
    expect: check([(run) => called(run, "camera"), "camera not used"], [(run) => !delegated(run), "sent a camera look to ask_lares"]),
  },
  {
    id: "clarify-answer",
    issue: "The answer to the Agent's question stayed with the dialogue",
    context: [{ role: "user", text: "帮我关一下灯" }, { role: "assistant", text: "好的，我让 Lares 去处理。" }],
    tasks: [{ requestId: "r1", status: "completed", text: "Which lights would you like me to turn off? For example the living room or all lights." }],
    say: "就客厅那盏",
    expect: check([delegated, "answer not passed to ask_lares"]),
  },
  {
    id: "not-done-followup",
    issue: "\"the light is still on\" got another question instead of a retry",
    context: [{ role: "user", text: "把灯关了" }, { role: "assistant", text: "好的，灯已经关了。" }],
    tasks: [{ requestId: "r1", status: "completed", text: "Turned off light.living_room." }],
    say: "灯没有关啊，还亮着",
    expect: check([delegated, "retry not sent to ask_lares"], [(run) => speaks(run, "zh"), "did not answer in Chinese"]),
  },
  {
    id: "no-fabrication",
    issue: "A pending task was reported as done",
    context: [{ role: "user", text: "帮我关灯" }, { role: "assistant", text: "好的，正在处理。" }],
    say: "灯关了吗？",
    expect: check([(run) => !/(?<!是否)(已经|已)(关|关闭|关掉|完成)|关好了|完成了|(?<!whether it is |if it is )turned off|is off|done/i.test(run.text), "claimed a result no task reported"]),
  },
  {
    id: "greeting-en",
    issue: "The startup greeting came out in French",
    say: "Start the conversation now with a brief, spontaneous greeting in character. Keep it to one sentence, invite the user in naturally, and vary the wording each time.",
    expect: check([(run) => language(run.text) === "en", "greeting not in English"], [(run) => !delegated(run), "greeting sent to ask_lares"]),
  },
  {
    id: "after-task-result",
    issue: "A task result in history broke every later turn (system message not first)",
    context: [{ role: "user", text: "北京天气怎么样" }, { role: "assistant", text: "我去查一下。" }],
    tasks: [{ requestId: "r1", status: "completed", text: "北京今天 10–19°C，晴。" }],
    say: "谢谢，那明天呢？",
    expect: check([(run) => !run.error, "model call failed"], [(run) => speaks(run, "zh"), "did not answer in Chinese"]),
  },
  {
    id: "weather-zh",
    issue: "The robot's weather tool failed on 北京; either path is fine if it is used sensibly",
    say: "北京明天天气怎么样",
    expect: check([(run) => delegated(run) || run.calls.some((call) => call.name.endsWith("__get_weather") && /北京|beijing/i.test(call.arguments)), "no weather lookup"], [(run) => speaks(run, "zh"), "did not answer in Chinese"]),
  },
];
