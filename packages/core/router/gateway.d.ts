export function routerGatewayUrl(env?: NodeJS.ProcessEnv): string;
export function routerShimBaseUrl(env?: NodeJS.ProcessEnv): string;
export function routerEndUser(
  env?: NodeJS.ProcessEnv,
  incoming?: Record<string, string | string[] | undefined>,
): string;
export function routerAuthHeaders(
  apiKey: string | null | undefined,
  olaresAppId: string | null | undefined,
  olaresUser?: string | null,
): Record<string, string>;
export function routerHeaders(env?: NodeJS.ProcessEnv): Record<string, string>;
