/**
 * End-to-end check for Settings → Skills on an authenticated Olares entrance.
 *
 * Downloads Home Assistant skills, enables them, disables them, then leaves
 * the pack enabled. The returned snapshots are suitable for CI/debug logs.
 */

const TEXT = {
  settings: ["Settings", "设置"],
  pack: ["Home Assistant"],
  download: ["Download", "下载"],
  enable: ["Open", "打开"],
  disable: ["Close", "关闭"],
};

function clickByTextScript(labels, rootSelector) {
  return `(() => {
    const labels = ${JSON.stringify(labels)};
    const root = ${rootSelector ? `document.querySelector(${JSON.stringify(rootSelector)})` : "document"};
    if (!root) return false;
    const nodes = Array.from(root.querySelectorAll("button,a,[role=button],*"));
    const leaf = nodes.find((el) =>
      el.children.length === 0 && labels.includes((el.textContent || "").trim())
    );
    const target = leaf?.closest("button,a,[role=button]") || leaf;
    if (!target) return false;
    target.click();
    return true;
  })()`;
}

async function waitForText(page, labels, timeout = 30_000) {
  await page.waitFor(
    `(() => {
      const labels = ${JSON.stringify(labels)};
      return Array.from(document.querySelectorAll("*")).some(
        (el) => el.children.length === 0 && labels.includes((el.textContent || "").trim())
      );
    })()`,
    { timeout },
  );
}

async function clickByText(page, labels, rootSelector) {
  const clicked = await page.evaluate(clickByTextScript(labels, rootSelector));
  if (!clicked) throw new Error(`button not found: ${labels.join(" / ")}`);
}

async function panel(page) {
  return page.evaluate(`fetch("/api/lares/skills")
    .then(async (response) => ({ status: response.status, body: await response.json() }))`);
}

/** @param {import("../lib/chrome-cdp.mjs").Page} page */
export default async function (page) {
  const failures = [];
  page.cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    failures.push(exceptionDetails.exception?.description ?? exceptionDetails.text);
  });
  await page.send("Runtime.enable", {});

  await clickByText(page, TEXT.settings);
  await waitForText(page, ["Skills", "技能"]);
  await clickByText(page, ["Skills", "技能"]);
  try {
    await waitForText(page, TEXT.pack);
  } catch {
    const screenshot = "/tmp/lares-skill-packs-missing.png";
    await page.screenshot(screenshot);
    const diagnostics = await page.evaluate(`({
      href: location.href,
      text: document.body.innerText.slice(0, 4000),
      buttons: Array.from(document.querySelectorAll("button,a,[role=button]"))
        .map((el) => ({
          text: (el.textContent || "").trim(),
          label: el.getAttribute("aria-label"),
          title: el.getAttribute("title"),
        }))
        .filter((item) => item.text || item.label || item.title),
    })`);
    throw new Error(`Skills settings missing: ${JSON.stringify({ diagnostics, failures, screenshot })}`);
  }

  const before = await panel(page);
  if (before.status !== 200) throw new Error(`skills API returned ${before.status}`);

  if (!before.body.packs?.[0]?.downloaded) {
    await clickByText(page, TEXT.download, ".lares-skills-actions");
    await waitForText(page, TEXT.enable, 660_000);
  }
  const downloaded = await panel(page);

  if (!downloaded.body.packs?.[0]?.enabled) {
    await clickByText(page, TEXT.enable, ".lares-skills-actions");
    await waitForText(page, TEXT.disable);
  }
  const enabled = await panel(page);

  await clickByText(page, TEXT.disable, ".lares-skills-actions");
  await waitForText(page, TEXT.enable);
  const disabled = await panel(page);

  await clickByText(page, TEXT.enable, ".lares-skills-actions");
  await waitForText(page, TEXT.disable);
  const restored = await panel(page);

  const screenshot = "/tmp/lares-skill-packs-enabled.png";
  await page.screenshot(screenshot);
  return { before, downloaded, enabled, disabled, restored, failures, screenshot };
}
