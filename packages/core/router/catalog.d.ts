export interface RouterCatalogRow {
  id: string;
  name: string;
  mode: string | null;
  /** Whether Router declares native image input for this chat model. */
  supportsVision: boolean;
  /** Speech recognition, from `stt` / `stt_stream`. */
  supportsStt: boolean;
  /** Speech playback, from `tts`. */
  supportsTts: boolean;
  supportsSttStream: boolean;
  /** Router identifier → identical wire value, in declared order; null without effort capability. */
  reasoningEfforts: Record<string, string> | null;
  reasoningDefault?: string;
  /** Tokens one request may span, or null when Router states none. */
  contextWindow: number | null;
  /** Output tokens a turn may reserve: Router's limit capped at a quarter of the window. */
  maxTokens: number | null;
}

export function outputTokenBudget(declared: number | null, contextWindow: number | null): number | null;
export function routerCatalogRows(payload: unknown): RouterCatalogRow[];
