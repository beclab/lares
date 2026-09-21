import {
  assert,
  clickMarked,
  clickSettingsSection,
  collectBrowserErrors,
  markByText,
  waitForShell,
} from "./lib/helpers.mjs";

export default async function (page, session) {
  await session.cdp.send("Runtime.enable");
  await session.cdp.send("Log.enable");
  const browser = collectBrowserErrors(session);
  const checks = {};
  try {
    await waitForShell(page);
    await page.sleep(800);

    checks.shell = await page.evaluate(async () => {
      const styles = [...document.querySelectorAll("style[data-plugin-css]")]
        .map((element) => element.getAttribute("data-plugin-css"));
      const health = await fetch("/api/health");
      const commands = await fetch("/api/lares/commands");
      const references = await fetch("/api/lares/references");
      return {
        title: document.title,
        lang: document.documentElement.lang,
        uuid: crypto.randomUUID(),
        styles,
        brandMarks: document.querySelectorAll(".lares-brand-mark").length,
        brandNames: [...document.querySelectorAll(".lares-brand-name")].map((element) =>
          element.textContent?.trim(),
        ),
        health: health.status,
        commands: commands.status,
        references: references.status,
        voiceMounted: styles.includes("@lares/composer-voice"),
      };
    });
    assert(/Lares/.test(checks.shell.title), "document title is not branded");
    assert(checks.shell.brandMarks > 0, "Lares brand mark is missing");
    assert(checks.shell.brandNames.includes("Lares"), "Lares brand name is missing");
    assert(/^en-US$|^zh-CN$/.test(checks.shell.lang), `unexpected document lang ${checks.shell.lang}`);
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checks.shell.uuid), "crypto UUID shim failed");
    for (const style of [
      "@lares/brand",
      "@lares/chat-model",
      "@lares/router-search",
      "@lares/skill-packs",
      "@lares/workspace-preview",
      "@lares/workspace-preview-3d",
    ]) {
      assert(checks.shell.styles.includes(style), `plugin stylesheet missing: ${style}`);
    }
    assert(checks.shell.health === 200 && checks.shell.commands === 200 && checks.shell.references === 200, "Lares host APIs are unavailable");
    assert(checks.shell.voiceMounted === false, "disabled composer voice plugin unexpectedly mounted");

    await clickSettingsSection(page, /^(General|通用设置)$/);
    checks.settings = await page.evaluate(() => {
      const nav = [...document.querySelectorAll("button")]
        .filter((button) => /^(General|Models?|Web search|Skills|Plugins|通用设置|模型配置|网络搜索|技能|插件)$/i.test((button.textContent || "").trim()))
        .map((button) => ({
          label: (button.textContent || "").trim(),
          icon: Boolean(button.querySelector("svg,img")),
        }));
      const selectedTheme = [...document.querySelectorAll("button")]
        .find((button) => /^(Light|Dark|System|浅色|深色|跟随系统)$/i.test((button.textContent || "").trim()) && /selected/i.test(String(button.className)));
      return {
        nav,
        selectedTheme: selectedTheme?.textContent?.trim() ?? null,
        dark: document.body.hasAttribute("data-ds-dark-theme"),
      };
    });
    assert(checks.settings.nav.length === 5, `unexpected settings nav: ${JSON.stringify(checks.settings.nav)}`);
    assert(checks.settings.nav.every((item) => item.icon), "one or more settings nav icons are missing");

    await clickSettingsSection(page, /^(Skills|技能)$/);
    checks.skills = await page.evaluate(async () => {
      const response = await fetch("/api/lares/skills");
      const body = await response.json();
      return {
        status: response.status,
        packs: body.packs?.length ?? 0,
        panel: Boolean(document.querySelector(".lares-skills")),
      };
    });
    assert(checks.skills.status === 200 && checks.skills.packs > 0, "skill packs API is empty");

    const close = await markByText(page, "close-settings", /Close|关闭/);
    if (close) await clickMarked(page, "close-settings");
    await page.sleep(400);

    // Drive the real file input: a synthetic drop is claimed by dsh's own
    // DropOverlay, so it proves nothing about which picker is mounted.
    const attachmentName = `lares-e2e-attach-${Date.now()}.txt`;
    checks.attachment = await page.evaluate((name) => {
      const inputs = [...document.querySelectorAll("input[type=file]")];
      const official = inputs[0];
      if (official !== undefined) {
        const transfer = new DataTransfer();
        transfer.items.add(new File(["Lares attachment E2E\n"], name, { type: "text/plain" }));
        official.files = transfer.files;
        official.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return {
        officialButtons: [...document.querySelectorAll("button")]
          .filter((button) => /add attachment|添加附件/i.test(button.getAttribute("aria-label") || ""))
          .map((button) => ({ label: button.getAttribute("aria-label"), disabled: button.disabled })),
        laresPickers: document.querySelectorAll(".lares-file-picker").length,
        fileInputs: inputs.length,
      };
    }, [attachmentName]);
    assert(
      checks.attachment.laresPickers === 0,
      "the removed Lares composer picker is still mounted next to dsh's attachment button",
    );
    assert(
      checks.attachment.officialButtons.length === 1
      && checks.attachment.officialButtons[0].disabled === false,
      `dsh attachment button is missing or inert: ${JSON.stringify(checks.attachment)}`,
    );
    // page.waitFor cannot forward arguments, so poll the filename explicitly.
    for (let attempt = 0; attempt < 25 && !checks.attachment.accepted; attempt += 1) {
      await page.sleep(800);
      checks.attachment.accepted = await page.evaluate(
        (name) => (document.body?.innerText || "").includes(name),
        [attachmentName],
      );
    }
    assert(
      checks.attachment.accepted,
      `dsh attachment did not take the dropped document: ${JSON.stringify(checks.attachment)}`,
    );

    const flowSession = await page.evaluate(() => {
      const row = [...document.querySelectorAll("[role=treeitem]")].find((element) =>
        /FlowStudio|MiniMax H3/i.test(element.textContent || ""),
      );
      if (!row) return false;
      row.dataset.e2eFlowSession = "1";
      return true;
    });
    if (flowSession) {
      await page.click("[data-e2e-flow-session='1']");
      await page.sleep(1000);
      await page.waitFor(() => !(document.body?.innerText || "").includes("Loading history"), {
        timeout: 45_000,
      });
      await page.waitFor(() => Boolean(document.querySelector(".lares-turn-deliverables")), {
        timeout: 30_000,
      });
    }
    checks.historicalPreview = await page.evaluate(() => ({
      foundSession: Boolean(document.querySelector("[data-e2e-flow-session]")),
      deliverables: document.querySelectorAll(".lares-turn-deliverables").length,
      media: document.querySelectorAll(".lares-turn-media").length,
      fileButtons: document.querySelectorAll(".lares-turn-file").length,
    }));
    assert(
      !flowSession || checks.historicalPreview.deliverables > 0,
      `historical FlowStudio preview was not rebuilt: ${JSON.stringify(checks.historicalPreview)}`,
    );

    const actionableErrors = browser.errors.filter((message) => !/favicon/i.test(message));
    assert(actionableErrors.length === 0, `browser errors: ${actionableErrors.join(" | ")}`);
    const screenshot = `/tmp/lares-plugin-matrix-${Date.now()}.png`;
    await page.screenshot({ path: screenshot });
    return { checks, browserErrors: actionableErrors, screenshot };
  } finally {
    browser.dispose();
  }
}
