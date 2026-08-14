export interface DinaEnv {
  port: number;
  host: string;
  routerUrl: string;
  routerApiKey: string | null;
  olaresAppId: string;
  defaultModel: string | null;
  workspace: string;
  dataDir: string;
  cliRoot: string;
}

function readString(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function loadEnv(): DinaEnv {
  const portRaw = readString("PORT") ?? "8080";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${portRaw}`);
  }

  return {
    port,
    host: readString("HOSTNAME") ?? "0.0.0.0",
    routerUrl: (readString("LLM_GATEWAY_URL") ?? "http://router-svc.router-shared/v1").replace(/\/+$/, ""),
    routerApiKey: readString("DINA_ROUTER_API_KEY"),
    olaresAppId: readString("OLARES_APP_ID") ?? "dina",
    defaultModel: readString("DINA_DEFAULT_MODEL"),
    workspace: readString("DINA_WORKSPACE") ?? "/data/workspace",
    dataDir: readString("DINA_DATA_DIR") ?? "/data/dina",
    cliRoot: readString("DINA_CLI_ROOT") ?? "/data/cli",
  };
}
