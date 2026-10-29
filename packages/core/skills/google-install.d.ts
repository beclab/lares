export const GOG_VERSION: string;
export const GOOGLE_PACK: string;
export function googleCache(dir: string): string;
export function googleBin(dir: string): string;
export function googleHome(dir: string): string;
export function googleLauncher(dir: string): string;
export function gogAsset(platform?: string, arch?: string): string;
export function verifyGogChecksum(bytes: Uint8Array, checksums: string | Uint8Array, name: string): void;
export function fetchArtifact(url: string, max?: number): Promise<Buffer>;
export function installGoogleLauncher(dir: string): Promise<void>;
export function installGoogle(dir: string, options?: {
  download?: (url: string, max?: number) => Promise<Buffer>;
  run?: (command: string, args: string[], options?: Record<string, unknown>) => Promise<string>;
}): Promise<void>;
