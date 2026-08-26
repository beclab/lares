import { hostConfigFromEnv, hostUrl, MODELS_PATH, probeHost } from "@lares/core/larepass/host";
import { callRpc, consumeMux, ensureSession, loadTranscript, MUX_PATH, sendPrompt } from "@lares/core/larepass/chat";
import { muxWsUrl } from "@lares/core/larepass/mux";
import { downloadFileUrl, previewMetaUrl, rawFileUrl } from "@lares/core/files/preview-workspace";

function pageOrigin() {
  try {
    return globalThis.location?.origin || "http://localhost";
  } catch {
    return "http://localhost";
  }
}

function openMuxSocket(httpUrl, signal) {
  const Socket = globalThis.WebSocket;
  if (typeof Socket !== "function") {
    return Promise.resolve({
      ok: false,
      status: "error",
      error: { code: "no-websocket", message: "WebSocket is not available" },
    });
  }
  return new Promise((resolve) => {
    let settled = false;
    const socket = new Socket(muxWsUrl(httpUrl, pageOrigin()));
    const finish = (result) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = () => {
      try {
        socket.close();
      } catch {
        // already closing
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      finish({ ok: false, status: "error", error: { code: "aborted", message: "mux aborted" } });
      return;
    }
    socket.addEventListener("open", () => {
      finish({ ok: true, http: 101, status: 101, body: socket });
    }, { once: true });
    socket.addEventListener("error", () => {
      finish({
        ok: false,
        status: "unreachable",
        error: { code: "unreachable", message: "mux websocket failed" },
      });
    }, { once: true });
  });
}

export async function defaultRequest(url, init = {}) {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    body: init.body === undefined
      ? undefined
      : typeof init.body === "string"
        ? init.body
        : JSON.stringify(init.body),
    credentials: "include",
    redirect: "manual",
    signal: init.signal,
    headers: {
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...init.headers,
    },
  });
  const text = await res.text();
  let body;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    body,
  };
}

export function createHostClient(ports = {}) {
  const fromEnv = hostConfigFromEnv(ports.env);
  const baseUrl = ports.baseUrl ?? fromEnv.baseUrl;
  const proxyPrefix = ports.proxyPrefix ?? fromEnv.proxyPrefix;
  const send = ports.request ?? defaultRequest;
  const urlFor = (path) => hostUrl({ baseUrl, proxyPrefix, path });
  const request = (path, init) => send(urlFor(path), init);
  const rpc = (method, payload) => callRpc(request, method, payload);
  return {
    urlFor,
    probe() {
      if (!proxyPrefix && !baseUrl) {
        return Promise.resolve({ status: "missing" });
      }
      return probeHost((path) => request(path), MODELS_PATH);
    },
    rpc,
    ensureSession() {
      return ensureSession(rpc);
    },
    history(sessionId) {
      return loadTranscript(rpc, sessionId);
    },
    prompt(sessionId, text) {
      return sendPrompt(rpc, sessionId, text);
    },
    async preview(sessionId, path) {
      const res = await request(previewMetaUrl(sessionId, path));
      const http = Number(res?.status) || 0;
      const body = res?.body;
      if (http < 200 || http >= 300) {
        const code = body?.error?.code || "file_preview_failed";
        throw new Error(code);
      }
      return body;
    },
    mediaUrl(sessionId, path, modifiedAt) {
      return urlFor(rawFileUrl(sessionId, path, modifiedAt));
    },
    downloadUrl(sessionId, path) {
      return urlFor(downloadFileUrl(sessionId, path));
    },
    async openMux(signal) {
      try {
        return await openMuxSocket(urlFor(MUX_PATH), signal);
      } catch (err) {
        return {
          ok: false,
          status: "unreachable",
          error: { code: "unreachable", message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
    consumeMux,
  };
}
