export interface LaresEnv {
  port: number;
  host: string;
  routerUrl: string;
  routerApiKey: string | null;
  olaresAppId: string;
  workspace: string;
  dataDir: string;
  cliRoot: string;
}

function readString(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function loadEnv(): LaresEnv {
  const portRaw = readString("PORT") ?? "8080";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${portRaw}`);
  }

  return {
    port,
    host: readString("HOSTNAME") ?? "0.0.0.0",
    routerUrl: (readString("LLM_GATEWAY_URL") ?? "http://router-svc.router-shared/v1").replace(/\/+$/, ""),
    routerApiKey: readString("LARES_ROUTER_API_KEY"),
    olaresAppId: readString("OLARES_APP_ID") ?? "lares",
    workspace: readString("LARES_WORKSPACE") ?? "/data/workspace",
    dataDir: readString("LARES_DATA_DIR") ?? "/data/lares",
    cliRoot: readString("LARES_CLI_ROOT") ?? "/data/cli",
  };
}
