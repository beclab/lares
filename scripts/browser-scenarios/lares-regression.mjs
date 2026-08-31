/**
 * Authenticated Lares smoke regression.
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

async function assertRouterRoute(page, root, route) {
  const link = await page.evaluate(
    (rootSelector, expectedRoute) => {
      const button = [...document.querySelectorAll(`${rootSelector} .lares-settings-actions button`)].find((el) =>
        /Router/i.test(el.textContent || ""),
      );
      if (!button) return null;
      const original = window.open;
      let opened = null;
      window.open = (url) => {
        opened = url;
        return null;
      };
      button.click();
      window.open = original;
      const zone = location.hostname.split(".").slice(1).join(".");
      return { opened, expected: `https://router.${zone}/${expectedRoute}` };
    },
    [root, route],
  );
  assert(
    link && link.opened === link.expected,
    `unexpected Router console target for ${root}: ${JSON.stringify(link)}`,
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
        await page.screenshot("/tmp/lares-machine1-auth-failed.png");
        throw new Error(`Olares login did not complete: ${JSON.stringify(authState)}`);
      }
    }

    try {
      await page.waitFor(
        () => Boolean(document.querySelector("[data-phase]")),
        { timeout: 30_000 },
      );
    } catch {
      const state = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        phase: document.querySelector("[data-phase]")?.getAttribute("data-phase") || null,
        text: document.body?.textContent?.trim().slice(0, 500) || "",
      }));
      await page.screenshot("/tmp/lares-machine1-app-failed.png");
      throw new Error(`Lares shell did not become ready: ${JSON.stringify(state)}; errors=${errors.join(" | ")}`);
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
        pluginStyles: [...document.querySelectorAll("style[data-plugin-css]")].map(
          (tag) => tag.getAttribute("data-plugin-css"),
        ),
        api: await Promise.all([
          request("/api/health"),
          request("/llm/v1/models"),
        ]),
      };
    });
    assert(shell.title, "document title is empty");
    assert(shell.pluginStyles.includes("@lares/brand"), "brand stylesheet is missing");
    assert(shell.api.every((item) => item.ok), `API regression failed: ${JSON.stringify(shell.api)}`);

    const modelTrigger = await page.evaluate(() => Boolean(document.querySelector(".lares-model-trigger")));
    assert(modelTrigger, "model switch trigger is missing");
    await page.click(".lares-model-trigger");
    await page.waitFor(() => Boolean(document.querySelector(".lares-model-menu")), { timeout: 10_000 });
    const modelMenu = await page.evaluate(() => ({
      options: document.querySelectorAll(".lares-model-option").length,
      text: document.querySelector(".lares-model-menu")?.textContent?.trim().slice(0, 300),
    }));
    assert(modelMenu.options > 0, "model switch menu has no model options");
    await page.press("Escape");

    const settingsLabel = await markByText(page, "settings", /设置|settings/);
    assert(settingsLabel, "settings control was not found");
    await page.click('[data-regression-target="settings"]');
    await page.sleep(500);

    const settingsOrder = await page.evaluate(() => {
      const classify = (text) => {
        if (/^(通用设置|general)$/i.test(text)) return "general";
        if (/^(模型配置|model configuration)$/i.test(text)) return "models";
        if (/^(网络搜索|web search)$/i.test(text)) return "web-search";
        if (/^(插件|plugins)$/i.test(text)) return "plugins";
        return null;
      };
      return [...document.querySelectorAll("button")]
        .map((button) => classify(button.textContent?.trim() || ""))
        .filter(Boolean);
    });
    assert(
      JSON.stringify(settingsOrder) === JSON.stringify(["general", "models", "web-search", "plugins"]),
      `unexpected settings order: ${JSON.stringify(settingsOrder)}`,
    );

    const modelsNav = await markByText(page, "models-settings", /^模型配置$|^model configuration$/);
    assert(modelsNav, "models settings navigation item was not found");
    await page.click('[data-regression-target="models-settings"]');
    await page.waitFor(() => Boolean(document.querySelector(".lares-models .lares-settings-status")), { timeout: 10_000 });
    const modelSettings = await page.evaluate(() => ({
      status: document.querySelector(".lares-models .lares-settings-status")?.textContent?.trim(),
      actions: [...document.querySelectorAll(".lares-models .lares-settings-actions button")].map((button) =>
        button.textContent?.trim(),
      ),
    }));
    assert(modelSettings.status, "models availability status is missing");
    assert(
      modelSettings.actions.length === 2 && /Router/i.test(modelSettings.actions[1] ?? ""),
      `unexpected models header actions: ${JSON.stringify(modelSettings.actions)}`,
    );

    await assertRouterRoute(page, ".lares-models", "llm");
    const modelsShot = "/tmp/lares-models-settings.png";
    await page.screenshot(modelsShot);

    const searchNav = await markByText(page, "search-settings", /^网络搜索$|^web search$/);
    assert(searchNav, "web search settings navigation item was not found");
    await page.click('[data-regression-target="search-settings"]');
    await page.waitFor(() => Boolean(document.querySelector(".lares-websearch .lares-settings-status")), { timeout: 10_000 });
    const searchSettings = await page.evaluate(() => ({
      status: document.querySelector(".lares-websearch .lares-settings-status")?.textContent?.trim(),
      actions: [...document.querySelectorAll(".lares-websearch .lares-settings-actions button")].map((button) =>
        button.textContent?.trim(),
      ),
    }));
    assert(searchSettings.status, "web search availability status is missing");
    assert(
      searchSettings.actions.length === 2 && /Router/i.test(searchSettings.actions[1] ?? ""),
      `unexpected web search header actions: ${JSON.stringify(searchSettings.actions)}`,
    );
    await assertRouterRoute(page, ".lares-websearch", "tools");

    const lightShot = "/tmp/lares-machine1-light.png";
    const darkShot = "/tmp/lares-machine1-dark.png";
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

    const ignoredErrors = [/favicon/i];
    const actionableErrors = errors.filter((message) => !ignoredErrors.some((pattern) => pattern.test(message)));
    assert(actionableErrors.length === 0, `browser errors: ${actionableErrors.join(" | ")}`);

    return {
      shell,
      modelMenu,
      modelSettings,
      searchSettings,
      modelsShot,
      lightShot,
      darkShot,
      browserErrors: actionableErrors,
    };
  } finally {
    offException();
    offLog();
    offConsole();
  }
}
