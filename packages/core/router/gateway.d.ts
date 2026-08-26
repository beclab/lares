export function routerGatewayUrl(env?: NodeJS.ProcessEnv): string;
export function routerShimBaseUrl(env?: NodeJS.ProcessEnv): string;
export function routerAuthHeaders(apiKey: string | null | undefined, olaresAppId: string | null | undefined): Record<string, string>;
export function routerHeaders(env?: NodeJS.ProcessEnv): Record<string, string>;
