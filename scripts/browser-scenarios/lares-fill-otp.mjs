export default async function (page) {
  const dump = () =>
    page.evaluate(() => ({
      url: location.href,
      text: (document.body?.innerText || "").trim().slice(0, 500),
      otpCount: document.querySelectorAll(".otp-input").length,
      otpValues: [...document.querySelectorAll(".otp-input")].map((el) => el.value),
      composer: Boolean(document.querySelector("textarea,[contenteditable=true],[data-phase]")),
    }));

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

  await page.waitFor(() => Boolean(document.querySelector('input[type="password"]')), {
    timeout: 25_000,
  });
  await page.type("#password", process.env.OLARES_PASSWORD, { clear: true });
  await enter();
  await page.sleep(3500);

  if (!(await page.evaluate(() => document.querySelectorAll(".otp-input").length))) {
    await page.evaluate(() => document.querySelector(".login-hint")?.click());
    await page.sleep(1500);
  }
  await page.waitFor(() => document.querySelectorAll(".otp-input").length >= 6, { timeout: 10_000 });

  const otp = process.env.OLARES_OTP || "";
  const slots = ["one", "two", "three", "four", "five", "six"];
  for (let i = 0; i < 6; i += 1) {
    await page.click(`.otp-input.${slots[i]}`);
    await page.type(`.otp-input.${slots[i]}`, otp[i] || "", { clear: true });
  }
  await page.sleep(5000);
  await page.screenshot("/tmp/lares-after-otp.png");
  return dump();
}
