/**
 * Authenticated Dina smoke regression.
 *
 * OLARES_PASSWORD must be provided through the environment when the entrance
 * redirects to auth. The scenario never prints it.
 */

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function markByText(page, marker, pattern) {
  return page.evaluate(
    (name, source) => {
      const re = new RegExp(source, "i");
      const candidates = document.querySelectorAll("button,[role=button],[role=tab],a");
      for (const el of candidates) {
        const text = `${el.getAttribute("aria-label") || ""} ${el.textContent || ""}`.trim();
        if (!re.test(text)) continue;
        el.dataset.regressionTarget = name;
        return text;
      }
      return null;
    },
    [marker, pattern.source],
  );
}

export default async function (page, session) {
  const errors = [];
  await session.cdp.send("Runtime.enable");
  await session.cdp.send("Log.enable");
  const offException = session.cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    errors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || "runtime exception");
  });
  const offLog = session.cdp.on("Log.entryAdded", ({ entry }) => {
    if (entry?.level === "error") errors.push(entry.text);
  });
  const offConsole = session.cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
    if (type === "error") errors.push(args?.map((arg) => arg.value || arg.description).join(" "));
  });

  try {
    await page.waitFor(
      () => Boolean(document.querySelector('input[type="password"]') || document.querySelector("[data-phase]")),
      { timeout: 20_000 },
    );
    const passwordInput = await page.evaluate(() => Boolean(document.querySelector('input[type="password"]')));
    if (passwordInput) {
      const password = process.env.OLARES_PASSWORD;
      assert(password, "OLARES_PASSWORD is required for the Olares login page");
      await page.type('input[type="password"]', password);
      await page.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });
      await page.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });
      await page.sleep(4000);
      const authState = await page.evaluate(() => ({
        url: location.href,
        inputPresent: Boolean(document.querySelector('input[type="password"]')),
        inputLength: document.querySelector('input[type="password"]')?.value.length || 0,
        notice: document.querySelector("#q-notify")?.textContent?.trim() || "",
      }));
      if (authState.inputPresent) {
        await page.screenshot("/tmp/dina-machine1-auth-failed.png");
        throw new Error(`Olares login did not complete: ${JSON.stringify(authState)}`);
      }
    }

    try {
      await page.waitFor(
        () => Boolean(document.querySelector("[data-phase]") && document.querySelector(".dina-voice-mic")),
        { timeout: 30_000 },
      );
    } catch {
      const state = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        phase: document.querySelector("[data-phase]")?.getAttribute("data-phase") || null,
        mic: Boolean(document.querySelector(".dina-voice-mic")),
        text: document.body?.textContent?.trim().slice(0, 500) || "",
      }));
      await page.screenshot("/tmp/dina-machine1-app-failed.png");
      throw new Error(`Dina shell did not become ready: ${JSON.stringify(state)}; errors=${errors.join(" | ")}`);
    }
    await page.sleep(1500);

    const shell = await page.evaluate(async () => {
      const request = async (path) => {
        const response = await fetch(path);
        return { path, status: response.status, ok: response.ok };
      };
      return {
        title: document.title,
        phase: document.querySelector("[data-phase]")?.getAttribute("data-phase"),
        micLabel: document.querySelector(".dina-voice-mic")?.getAttribute("aria-label"),
        pluginStyles: [...document.querySelectorAll("style[data-plugin-css]")].map(
          (tag) => tag.getAttribute("data-plugin-css"),
        ),
        api: await Promise.all([
          request("/api/health"),
          request("/api/dina/voice/config"),
          request("/api/dina/voice/status"),
          request("/api/dina/voice/models"),
          request("/llm/v1/models"),
        ]),
      };
    });
    assert(shell.title, "document title is empty");
    assert(shell.micLabel, "voice microphone is not mounted");
    assert(shell.pluginStyles.includes("@dina/client-dina"), "client-dina stylesheet is missing");
    assert(shell.pluginStyles.includes("@dina/voice-input"), "voice-input stylesheet is missing");
    assert(shell.api.every((item) => item.ok), `API regression failed: ${JSON.stringify(shell.api)}`);

    const modelTrigger = await page.evaluate(() => Boolean(document.querySelector(".dina-model-trigger")));
    assert(modelTrigger, "model switch trigger is missing");
    await page.click(".dina-model-trigger");
    await page.waitFor(() => Boolean(document.querySelector(".dina-model-menu")), { timeout: 10_000 });
    const modelMenu = await page.evaluate(() => ({
      options: document.querySelectorAll(".dina-model-option").length,
      text: document.querySelector(".dina-model-menu")?.textContent?.trim().slice(0, 300),
    }));
    assert(modelMenu.options > 0, "model switch menu has no model options");
    await page.press("Escape");

    const settingsLabel = await markByText(page, "settings", /设置|settings/);
    assert(settingsLabel, "settings control was not found");
    await page.click('[data-regression-target="settings"]');
    await page.sleep(500);

    const voiceNav = await markByText(page, "voice-settings", /语音输入|voice input/);
    assert(voiceNav, "voice settings navigation item was not found");
    await page.click('[data-regression-target="voice-settings"]');
    await page.waitFor(() => Boolean(document.querySelector(".dina-voice-title")), { timeout: 10_000 });

    const settings = await page.evaluate(() => {
      const root = document.querySelector(".dina-voice");
      const selector = root?.querySelector(".dina-voice-selector");
      return {
        title: root?.querySelector(".dina-voice-title")?.textContent,
        status: root?.querySelector(".dina-voice-status")?.textContent?.trim(),
        selectors: root?.querySelectorAll(".dina-voice-selector").length || 0,
        actions: root?.querySelectorAll(".dina-voice-actions button").length || 0,
        selectorHeight: selector ? getComputedStyle(selector).height : null,
        color: root ? getComputedStyle(root).color : null,
      };
    });
    assert(settings.title, "voice settings title is missing");
    assert(settings.status, "voice status is missing");
    assert(settings.selectors === 2, `expected 2 voice selectors, got ${settings.selectors}`);
    assert(settings.actions === 2, `expected 2 voice actions, got ${settings.actions}`);
    assert(settings.selectorHeight === "36px", `unexpected selector height ${settings.selectorHeight}`);

    const lightShot = "/tmp/dina-machine1-light.png";
    const darkShot = "/tmp/dina-machine1-dark.png";
    await page.screenshot(lightShot, { fullPage: true });
    await page.evaluate(() => {
      document.body.dataset.regressionHadDark = document.body.hasAttribute("data-ds-dark-theme") ? "1" : "0";
      document.body.setAttribute("data-ds-dark-theme", "");
    });
    await page.sleep(250);
    await page.screenshot(darkShot, { fullPage: true });
    await page.evaluate(() => {
      if (document.body.dataset.regressionHadDark !== "1") document.body.removeAttribute("data-ds-dark-theme");
      delete document.body.dataset.regressionHadDark;
    });

    await page.click(".dina-voice-selector");
    await page.waitFor(() => Boolean(document.querySelector('[role="menu"]')), { timeout: 5_000 });
    const menuItems = await page.evaluate(() => document.querySelectorAll('[role="menu"] [role^="menuitem"]').length);
    assert(menuItems > 0, "voice selector menu has no options");

    const ignoredErrors = [/favicon/i];
    const actionableErrors = errors.filter((message) => !ignoredErrors.some((pattern) => pattern.test(message)));
    assert(actionableErrors.length === 0, `browser errors: ${actionableErrors.join(" | ")}`);

    return { shell, modelMenu, settings, lightShot, darkShot, browserErrors: actionableErrors };
  } finally {
    offException();
    offLog();
    offConsole();
  }
}
