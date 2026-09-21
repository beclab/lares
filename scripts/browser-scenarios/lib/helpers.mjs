export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function markByText(page, marker, pattern, selector = "button,[role=button],[role=tab],a") {
  return page.evaluate(
    (name, source, candidates) => {
      const re = new RegExp(source, "i");
      for (const old of document.querySelectorAll("[data-e2e-target]")) {
        delete old.dataset.e2eTarget;
      }
      for (const element of document.querySelectorAll(candidates)) {
        const text = [
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.textContent,
        ].filter(Boolean).join(" ").trim();
        if (!re.test(text)) continue;
        element.dataset.e2eTarget = name;
        return text;
      }
      return null;
    },
    [marker, pattern.source, selector],
  );
}

export async function clickMarked(page, marker) {
  await page.click(`[data-e2e-target="${marker}"]`);
}

export function collectBrowserErrors(session) {
  const errors = [];
  const disposers = [];
  disposers.push(session.cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    errors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || "runtime exception");
  }));
  disposers.push(session.cdp.on("Log.entryAdded", ({ entry }) => {
    if (entry?.level === "error") errors.push(entry.text);
  }));
  disposers.push(session.cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
    if (type === "error") errors.push(args?.map((arg) => arg.value || arg.description).join(" "));
  }));
  return {
    errors,
    dispose() {
      for (const dispose of disposers) dispose();
    },
  };
}

export async function waitForShell(page, timeout = 30_000) {
  await page.waitFor(() => Boolean(document.querySelector("[data-phase]")), { timeout });
}

export async function setComposerDraft(page, text) {
  const needsWorkspace = await page.evaluate(() => {
    const input = document.querySelector("[data-composer-input]");
    return input?.getAttribute("aria-haspopup") === "menu";
  });
  if (needsWorkspace) {
    const trigger = await page.evaluate(() => {
      const input = document.querySelector("[data-composer-input]");
      if (!input) return null;
      const box = input.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
    if (trigger) await page.mouseClick(trigger.x, trigger.y);
    await page.sleep(200);
    const option = await page.evaluate(() => {
      const element = [...document.querySelectorAll("button,[role=option],[role=menuitem]")]
        .filter((candidate) => /^(Default|默认)$/.test((candidate.textContent || "").trim()))
        .at(-1);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
    if (!option) return false;
    await page.mouseClick(option.x, option.y);
    await page.sleep(300);
  }
  const target = await page.evaluate(() => {
    const input = document.querySelector("[data-composer-input], textarea[data-phase], textarea");
    if (!input) return null;
    input.scrollIntoView({ block: "center", inline: "center" });
    const box = input.getBoundingClientRect();
    return {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      textarea: input instanceof HTMLTextAreaElement,
    };
  });
  if (target === null) return false;
  await page.mouseClick(target.x, target.y);
  await page.evaluate((textarea) => {
    const input = document.querySelector("[data-composer-input], textarea[data-phase], textarea");
    if (!input) return;
    if (textarea) {
      input.select();
      return;
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [target.textarea]);
  await page.send("Input.insertText", { text });
  return page.evaluate((expected) => {
    const input = document.querySelector("[data-composer-input], textarea[data-phase], textarea");
    return (input?.value ?? input?.textContent ?? "").includes(expected);
  }, [text.slice(0, 12)]);
}

export function composerText() {
  const input = document.querySelector("[data-composer-input], textarea[data-phase], textarea");
  return input?.value ?? input?.textContent ?? "";
}

export async function clickSettingsSection(page, pattern) {
  let section = await markByText(page, "settings-section", pattern);
  if (!section) {
    const settings = await markByText(page, "settings", /Settings|设置/);
    assert(settings, "settings control not found");
    await clickMarked(page, "settings");
    await page.sleep(400);
    section = await markByText(page, "settings-section", pattern);
  }
  assert(section, `settings section not found: ${pattern}`);
  await clickMarked(page, "settings-section");
  await page.sleep(400);
}
