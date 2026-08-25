export default async function (page) {
  const enter = async () => {
    for (const type of ["keyDown", "keyUp"]) {
      await page.send("Input.dispatchKeyEvent", {
        type,
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });
    }
  };
  await page.waitFor(() => Boolean(document.querySelector("input[type=password]")), { timeout: 25_000 });
  await page.type("#password", process.env.OLARES_PASSWORD, { clear: true });
  await enter();
  await page.sleep(3500);
  if (!(await page.evaluate(() => document.querySelectorAll(".otp-input").length))) {
    await page.evaluate(() => document.querySelector(".login-hint")?.click());
    await page.sleep(1500);
  }
  await page.waitFor(() => document.querySelectorAll(".otp-input").length >= 6, { timeout: 10_000 });
  const otp = process.env.OLARES_OTP || "";
  await page.evaluate((code) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const inputs = [...document.querySelectorAll(".otp-input")];
    for (let i = 0; i < 6; i += 1) {
      const el = inputs[i];
      const digit = code[i] || "";
      el.focus();
      setter.call(el, digit);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: digit, inputType: "insertText" }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, [otp]);
  await page.sleep(2500);
  await page.screenshot("/tmp/lares-after-otp.png");
  return page.evaluate(() => ({
    marker: "fill-native-v1",
    url: location.href,
    text: (document.body?.innerText || "").trim().slice(0, 400),
    values: [...document.querySelectorAll(".otp-input")].map((el) => el.value),
    composer: Boolean(document.querySelector("textarea,[contenteditable=true],[data-phase]")),
  }));
}
