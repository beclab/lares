import { hostConfigFromEnv, hostUrl, MODELS_PATH, probeHost } from "@olares/lares-core/larepass/host";
import { callRpc, consumeMux, ensureSession, loadTranscript, MUX_PATH, sendPrompt } from "@olares/lares-core/larepass/chat";
import { muxWsUrl } from "@olares/lares-core/larepass/mux";
import { RESPOND_PATH } from "@olares/lares-core/larepass/rpc";
import { createHostSettings } from "@olares/lares-core/larepass/settings";
import { downloadFileUrl, previewMetaUrl, rawFileUrl } from "@olares/lares-core/files/preview-workspace";
import { FILES_UPLOAD_PATH, uploadFile } from "@olares/lares-core/files/upload-client";
import { API as VOICE_API, postTranscribe } from "@olares/lares-core/voice/client";

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
    async respond(message) {
      const res = await request(RESPOND_PATH, { method: "POST", body: message });
      const body = res?.body;
      if (body && typeof body === "object" && typeof body.accepted === "boolean") return body;
      return { accepted: Boolean(res?.ok), reason: res?.ok ? undefined : "bad-response" };
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
    upload(sessionId, file, options) {
      return uploadFile(file, sessionId, { ...options, url: urlFor(FILES_UPLOAD_PATH) });
    },
    transcribe(blob, language, signal) {
      return postTranscribe(blob, language, signal, { baseUrl: urlFor(VOICE_API) });
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
    settings: createHostSettings(request),
  };
}
