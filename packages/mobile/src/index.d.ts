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
  /**
   * Token offered as `Sec-WebSocket-Protocol` on the mux upgrade, which cannot
   * carry `X-Authorization`. Pass a function to have it read per connect.
   */
  socketProtocol?: string | string[] | (() => string | string[] | undefined);
  /** LarePass sets this when myApps has no Lares app. The entrance page leaves it unset. */
  missing?: boolean;
};

export const PC_TEST_PROXY: string;

export function findLaresEntrance(apps?: unknown[]): string;

export function hostConfigFromEnv(env?: HostEnv): {
  baseUrl: string;
  proxyPrefix: string;
};

export function hostKey(ports?: HostPorts): string;

export function laresPortsFromAccount(input?: {
  env?: HostEnv;
  apps?: unknown[];
}): {
  baseUrl?: string;
  env?: HostEnv;
  proxyPrefix?: string;
  missing?: boolean;
};

export function defaultRequest(url: string, init?: HostRequestInit): Promise<HostResponse>;

export function createHostClient(ports?: HostPorts): {
  urlFor: (path: string) => string;
  probe: () => Promise<{ status: string; http?: number; error?: string }>;
  ensureSession: () => Promise<{ ok: boolean; value?: { sessionId: string } }>;
  history: (sessionId: string) => Promise<{ ok: boolean; value?: unknown }>;
  prompt: (sessionId: string, text: string) => Promise<{ ok: boolean }>;
};

export type ChatDevice = "desktop" | "mobile";

export const LaresApp: DefineComponent<{
  locale?: string;
  device?: ChatDevice;
  baseUrl?: string;
  proxyPrefix?: string;
  env?: HostEnv;
  request?: (url: string, init?: HostRequestInit) => Promise<HostResponse>;
  socketProtocol?: HostPorts["socketProtocol"];
  missing?: boolean;
}>;

export const LaresAgentSettings: DefineComponent<{
  locale?: string;
  device?: ChatDevice;
  baseUrl?: string;
  proxyPrefix?: string;
  env?: HostEnv;
  request?: (url: string, init?: HostRequestInit) => Promise<HostResponse>;
  missing?: boolean;
  /** Register the settings close/navigation guard; exposed beforeLeave() is the imperative alternative. */
  bindBeforeLeave?: (listener: () => Promise<boolean>) => (() => void);
}>;
