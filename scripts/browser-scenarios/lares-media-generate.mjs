import { writeFile } from "node:fs/promises";
import { setComposerDraft } from "./lib/helpers.mjs";

const PROMPT = [
  "生成一张 512x512 的测试图片：纯白背景中央一个红色圆形。",
  "使用 lares-media-create，完成后必须 workspace_publish files_path。",
  "不要登录，不要 AskQuestion，不要修改 Router catalog，不要调用 router call 生成。",
  "最终只简短说明完成。",
].join("\n");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function clickCenter(page, selector) {
  const point = await page.evaluate((value) => {
    const element = document.querySelector(value);
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }, [selector]);
  if (!point) return false;
  await page.mouseClick(point.x, point.y);
  return true;
}

async function dismissInteraction(page) {
  return page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const skip = buttons.find((button) =>
      /skip this question|跳过此问题|跳过这个问题/i.test(button.textContent || ""),
    );
    if (skip && !skip.disabled) {
      skip.click();
      return "skip";
    }
    const allow = buttons.find((button) =>
      /^(Allow|Approve|Confirm|Continue|允许|批准|确认|继续)$/i.test(
        (button.textContent || "").trim(),
      ) && !button.disabled,
    );
    if (allow) {
      allow.click();
      return "allow";
    }
    return null;
  });
}

async function send(page) {
  const marked = await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) =>
      /^(Send message|发送)$/i.test(candidate.getAttribute("aria-label") || ""),
    );
    if (!button || button.disabled) return false;
    button.dataset.e2eSend = "1";
    return true;
  });
  return marked && clickCenter(page, "button[data-e2e-send='1']");
}

function snapshot() {
  const image = document.querySelector(".lares-turn-media img");
  const figure = image?.closest(".lares-turn-media");
  const path = figure?.querySelector(".lares-turn-media-caption [title]")?.getAttribute("title");
  const stop = [...document.querySelectorAll("button")].find((button) =>
    /^(Stop|停止|Stop generating)$/i.test(button.getAttribute("aria-label") || ""),
  );
  return {
    phase: document.querySelector("[data-phase]")?.getAttribute("data-phase") ?? null,
    sending: Boolean(stop),
    path: path ?? null,
    image: image ? {
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      src: String(image.currentSrc || image.src),
    } : null,
    turnMedia: document.querySelectorAll(".lares-turn-media").length,
    duplicateMentions: path
      ? [...document.querySelectorAll("code,a")].filter((element) =>
        (element.textContent || "").trim() === path,
      ).length
      : 0,
  };
}

export default async function (page) {
  await page.waitFor(() => Boolean(document.querySelector("[data-composer-input], [data-phase], textarea")), {
    timeout: 30_000,
  });
  await page.sleep(500);

  const newSession = await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) =>
      /^(New session|New Session|新会话|新对话)$/i.test(
        candidate.getAttribute("aria-label") || candidate.textContent || "",
      ),
    );
    if (!button) return false;
    button.dataset.e2eNewSession = "1";
    return true;
  });
  if (newSession) {
    await clickCenter(page, "button[data-e2e-new-session='1']");
    await page.sleep(1000);
  }

  const hasEditor = await page.evaluate(() => Boolean(document.querySelector(
    "[data-composer-input], textarea",
  )));
  if (!hasEditor) {
    const choose = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((candidate) =>
        /choose workspace|选择工作区/i.test(
          `${candidate.getAttribute("aria-label") || ""} ${candidate.textContent || ""}`,
        ),
      );
      if (!button) return false;
      button.dataset.e2eChooseWorkspace = "1";
      return true;
    });
    if (choose) {
      await clickCenter(page, "button[data-e2e-choose-workspace='1']");
      await page.sleep(500);
      const workspace = await page.evaluate(() => {
        const option = [...document.querySelectorAll("button,[role=option],[role=menuitem]")]
          .find((candidate) => /^(Default|默认)$/i.test((candidate.textContent || "").trim()));
        if (!option) return false;
        option.dataset.e2eWorkspace = "1";
        return true;
      });
      if (workspace) await clickCenter(page, "[data-e2e-workspace='1']");
      await page.waitFor(() => Boolean(document.querySelector(
        "[data-composer-input], textarea",
      )), { timeout: 15_000 });
    }
  }

  if (!(await setComposerDraft(page, PROMPT))) {
    throw new Error("media E2E could not set composer draft");
  }
  if (!(await send(page))) throw new Error("media E2E send button is unavailable");

  const deadline = Date.now() + 15 * 60_000;
  let sawSending = false;
  let state = await page.evaluate(snapshot);
  while (Date.now() < deadline) {
    await dismissInteraction(page);
    state = await page.evaluate(snapshot);
    sawSending ||= state.sending;
    if (
      sawSending
      && !state.sending
      && state.path
      && state.image?.complete
      && state.image.naturalWidth > 0
    ) {
      break;
    }
    await sleep(2000);
  }
  if (!state.path || !state.image || state.image.naturalWidth < 1) {
    throw new Error(`generated image preview did not appear: ${JSON.stringify(state)}`);
  }

  const raw = await page.evaluate(async (path) => {
    const sessionId = new URL(document.querySelector(".lares-turn-media img")?.src || "").searchParams.get("sessionId");
    const query = new URLSearchParams({ path, ...(sessionId ? { sessionId } : {}) });
    const response = await fetch(`/api/lares/file-preview/raw?${query}`, {
      headers: { range: "bytes=0-31" },
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      bytes: bytes.length,
    };
  }, [state.path]);
  if (![200, 206].includes(raw.status) || !raw.contentType?.startsWith("image/")) {
    throw new Error(`generated image raw endpoint failed: ${JSON.stringify(raw)}`);
  }

  const openButton = await page.evaluate((path) => {
    const figure = [...document.querySelectorAll(".lares-turn-media")].find((element) =>
      element.querySelector(`[title="${CSS.escape(path)}"]`),
    );
    const button = figure?.querySelector("button");
    if (!button) return false;
    button.dataset.e2eOpenPreview = "1";
    return true;
  }, [state.path]);
  if (openButton) {
    await clickCenter(page, "button[data-e2e-open-preview='1']");
    await page.waitFor(() => Boolean(document.querySelector("[data-file-preview-overlay]")), {
      timeout: 15_000,
    });
  }
  const screenshot = `/tmp/lares-media-generate-${Date.now()}.png`;
  await page.screenshot({ path: screenshot });
  const result = {
    ...state,
    raw,
    overlay: await page.evaluate(() => Boolean(document.querySelector("[data-file-preview-overlay]"))),
    screenshot,
  };
  if (process.env.LARES_E2E_RESULT) {
    await writeFile(process.env.LARES_E2E_RESULT, `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
}
