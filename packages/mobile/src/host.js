import { hostTarget, hostUrl, MODELS_PATH, probeHost } from "@olares/lares-core/larepass/host";
import { callRpc, consumeMux, ensureSession, loadTranscript, MUX_PATH, sendPrompt } from "@olares/lares-core/larepass/chat";
import { commandsUrl, normalizeCommands } from "@olares/lares-core/larepass/commands";
import { normalizeReferenceCandidates, referencesUrl } from "@olares/lares-core/larepass/references";
import { muxWsUrl, remoteStreamOpen, workspaceBaseline } from "@olares/lares-core/larepass/mux";
import { RESPOND_PATH } from "@olares/lares-core/larepass/rpc";
import { createHostSettings } from "@olares/lares-core/larepass/settings";
import {
  downloadFileUrl,
  isPreviewPayload,
  previewMetaUrl,
  rawFileUrl,
} from "@olares/lares-core/files/preview-workspace";
import { FILES_UPLOAD_PATH, uploadFile } from "@olares/lares-core/files/upload-client";
import { API as VOICE_API, postTranscribe, voiceHeaders } from "@olares/lares-core/voice/client";
import { postReport, REPORT_PATH } from "@olares/lares-core/log/report";

function pageOrigin() {
  try {
    return globalThis.location?.origin || "http://localhost";
  } catch {
    return "http://localhost";
  }
}

/**
 * A browser `WebSocket` takes no headers, so the mux upgrade cannot carry the
 * `X-Authorization` every other call uses and a cross-origin host page — a
 * packaged LarePass build sends no Olares cookie — is answered 401. Olares
 * reads the token off `Sec-WebSocket-Protocol` instead and promotes it to the
 * header before the entrance auth runs, so the host hands one down here.
 *
 * Read at connect time rather than captured with the client: a refreshed token
 * then lands on the next reconnect instead of needing a rebuilt runtime.
 */
function socketProtocols(ports) {
  const value = typeof ports.socketProtocol === "function"
    ? ports.socketProtocol()
    : ports.socketProtocol;
  if (Array.isArray(value)) return value.length > 0 ? value : undefined;
  return value ? String(value) : undefined;
}

function listWorkspaces(ports) {
  const Socket = globalThis.WebSocket;
  if (typeof Socket !== "function") {
    return Promise.resolve({
      ok: false,
      status: "error",
      error: { code: "no-websocket", message: "WebSocket is not available" },
    });
  }
  const streamId = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `ws-${Date.now()}`;
  return openMuxSocket(hostUrl({
    baseUrl: hostTarget(ports).baseUrl,
    proxyPrefix: hostTarget(ports).proxyPrefix,
    path: MUX_PATH,
  }), undefined, socketProtocols(ports)).then((opened) => {
    if (!opened.ok || !opened.body) {
      return {
        ok: false,
        status: opened.status || "error",
        error: opened.error || { code: "workspace", message: "workspace follow failed" },
      };
    }
    const socket = opened.body;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket.send(JSON.stringify({ type: "cancel", streamId }));
        } catch {
          // already closing
        }
        try {
          socket.close();
        } catch {
          // already closing
        }
        resolve(result);
      };
      const timer = setTimeout(() => {
        finish({
          ok: false,
          status: "error",
          error: { code: "workspace", message: "workspace follow timed out" },
        });
      }, 8000);
      socket.addEventListener("message", (event) => {
        let message;
        try {
          message = JSON.parse(String(event.data ?? ""));
        } catch {
          return;
        }
        const baseline = workspaceBaseline(message);
        if (!baseline) return;
        finish({ ok: true, status: "ok", value: baseline });
      });
      socket.send(JSON.stringify(remoteStreamOpen(streamId, "workspace/follow")));
    });
  });
}

function openMuxSocket(httpUrl, signal, protocols) {
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
    const url = muxWsUrl(httpUrl, pageOrigin());
    // Offering a subprotocol the server does not echo back aborts the
    // handshake, so a host that hands down none keeps the bare constructor.
    const socket = protocols === undefined ? new Socket(url) : new Socket(url, protocols);
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

/** Audio and file bodies go out as bytes; only plain objects are JSON. */
function isBinaryBody(body) {
  return (typeof Blob !== "undefined" && body instanceof Blob)
    || body instanceof ArrayBuffer
    || ArrayBuffer.isView(body)
    || (typeof FormData !== "undefined" && body instanceof FormData);
}

export async function defaultRequest(url, init = {}) {
  const raw = init.body === undefined || typeof init.body === "string" || isBinaryBody(init.body);
  const res = await fetch(url, {
    method: init.method ?? "GET",
    body: raw ? init.body : JSON.stringify(init.body),
    credentials: "include",
    redirect: "manual",
    signal: init.signal,
    headers: {
      ...(init.body === undefined || isBinaryBody(init.body) ? {} : { "content-type": "application/json" }),
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
  const { baseUrl, proxyPrefix } = hostTarget(ports);
  const send = ports.request ?? defaultRequest;
  const urlFor = (path) => hostUrl({ baseUrl, proxyPrefix, path });
  const direct = (url, init) => {
    if (ports.missing) {
      return Promise.resolve({ ok: false, status: 0, body: { error: { code: "missing" } } });
    }
    return send(url, init);
  };
  const request = (path, init) => direct(urlFor(path), init);
  const rpc = (method, payload) => (
    method === "workspace.list" ? listWorkspaces(ports) : callRpc(request, method, payload)
  );
  return {
    urlFor,
    probe() {
      if (ports.missing) return Promise.resolve({ status: "missing" });
      return probeHost((path) => request(path), MODELS_PATH);
    },
    rpc,
    ensureSession() {
      return ensureSession(rpc);
    },
    history(sessionId) {
      return loadTranscript(rpc, sessionId);
    },
    prompt(sessionId, content, mode) {
      return sendPrompt(rpc, sessionId, content, mode);
    },
    async respond(message) {
      const res = await request(RESPOND_PATH, { method: "POST", body: message });
      const body = res?.body;
      if (body && typeof body === "object" && typeof body.accepted === "boolean") return body;
      return { accepted: Boolean(res?.ok), reason: res?.ok ? undefined : "bad-response" };
    },
    async commands(sessionId) {
      const res = await request(commandsUrl(sessionId));
      const http = Number(res?.status) || 0;
      if (http < 200 || http >= 300) {
        throw new Error(res?.body?.error?.code || `commands ${http || "failed"}`);
      }
      return normalizeCommands(res?.body);
    },
    async references(sessionId, query, quoted = false) {
      const res = await request(referencesUrl(sessionId, query));
      const http = Number(res?.status) || 0;
      if (http < 200 || http >= 300) {
        throw new Error(res?.body?.error?.code || `references ${http || "failed"}`);
      }
      return normalizeReferenceCandidates(res?.body, quoted);
    },
    async preview(sessionId, path) {
      const res = await request(previewMetaUrl(sessionId, path));
      const http = Number(res?.status) || 0;
      const body = res?.body;
      if (http < 200 || http >= 300) {
        const code = body?.error?.code || "file_preview_failed";
        throw new Error(code);
      }
      if (!isPreviewPayload(body)) throw new Error("file_preview_failed");
      return body;
    },
    mediaUrl(sessionId, path, modifiedAt, size) {
      return urlFor(rawFileUrl(sessionId, path, modifiedAt, size));
    },
    downloadUrl(sessionId, path) {
      return urlFor(downloadFileUrl(sessionId, path));
    },
    // Binary bodies stay off the JSON path. `direct` still uses the host's
    // auth port, or cookie fetch when none was given, and does not call out
    // when LarePass has no entrance.
    upload(sessionId, file, options) {
      return uploadFile(file, sessionId, {
        ...options,
        url: urlFor(FILES_UPLOAD_PATH),
        request: direct,
      });
    },
    voiceRequest(path, options) { return request(path, options); },
    transcribe(blob, language, signal) {
      return postTranscribe(blob, language, signal, {
        baseUrl: urlFor(VOICE_API),
        request: direct,
      });
    },
    reportLog(scope, event, fields) {
      return postReport({ scope, event, ...(fields ?? {}) }, {
        request: direct,
        url: urlFor(REPORT_PATH),
      });
    },
    /** Hands over a streaming answer's text; with `part`, also returns that sentence's audio. */
    async speak({ key, text, done, part }) {
      const res = await request(`${VOICE_API}/speak`, {
        method: "POST",
        headers: voiceHeaders("device"),
        body: Number.isInteger(part) ? { key, text, done, part } : { key, text, done },
      });
      const body = res?.body;
      if (res?.ok && body && !Number.isInteger(part)) return { sentences: Number(body.sentences) || 0 };
      if (res?.ok && body && typeof body.audio === "string") {
        return {
          bluetooth: body.bluetooth === "played" ? "played" : "skipped",
          audio: body.audio,
        };
      }
      const error = body && typeof body === "object" ? body.error : null;
      const code = typeof error?.code === "string" && error.code ? error.code : "voice_speak_failed";
      const message = typeof error?.message === "string" && error.message ? error.message : code;
      throw Object.assign(new Error(message), { code });
    },
    async interruptSpeech() {
      const res = await request(`${VOICE_API}/playback/stop`, { method: "POST", headers: voiceHeaders("device") });
      return Boolean(res?.ok);
    },
    async openMux(signal) {
      if (ports.missing) {
        return { ok: false, status: "missing", error: { code: "missing", message: "no entrance" } };
      }
      try {
        return await openMuxSocket(urlFor(MUX_PATH), signal, socketProtocols(ports));
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
