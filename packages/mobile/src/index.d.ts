import { DefineComponent } from "vue";

export type HostRequestInit = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

export type HostResponse = {
  ok: boolean;
  status: number;
  body?: unknown;
};

export type HostEnv = {
  PROTOCOL?: string;
  LARES_SUB_DOMAIN?: string;
  ACCOUNT_DOMAIN?: string;
  IS_PC_TEST?: string | boolean | number;
};

export type HostPorts = {
  baseUrl?: string;
  proxyPrefix?: string;
  env?: HostEnv;
  request?: (url: string, init?: HostRequestInit) => Promise<HostResponse>;
};

export const PC_TEST_PROXY: string;

export function hostConfigFromEnv(env?: HostEnv): {
  baseUrl: string;
  proxyPrefix: string;
};

export function defaultRequest(url: string, init?: HostRequestInit): Promise<HostResponse>;

export function createHostClient(ports?: HostPorts): {
  urlFor: (path: string) => string;
  probe: () => Promise<{ status: string; http?: number; error?: string }>;
  ensureSession: () => Promise<{ ok: boolean; value?: { sessionId: string } }>;
  history: (sessionId: string) => Promise<{ ok: boolean; value?: unknown }>;
  prompt: (sessionId: string, text: string) => Promise<{ ok: boolean }>;
};

export const LaresApp: DefineComponent<{
  locale?: string;
  baseUrl?: string;
  proxyPrefix?: string;
  env?: HostEnv;
  request?: (url: string, init?: HostRequestInit) => Promise<HostResponse>;
}>;

export const LaresAgentSettings: DefineComponent<{
  locale?: string;
  baseUrl?: string;
  proxyPrefix?: string;
  env?: HostEnv;
  request?: (url: string, init?: HostRequestInit) => Promise<HostResponse>;
}>;
