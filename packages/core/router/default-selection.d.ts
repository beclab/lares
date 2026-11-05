export interface ModelSelection { provider: string; model: string; reasoningEffort?: string }
export function resolveDefaultSelection<T extends ModelSelection>(current: T, models: { id: string }[], preferred?: string | null): T | ModelSelection;
export function ensureDefaultSelection(service: { currentSelection(): ModelSelection; saveSelection(next: ModelSelection, options: { expected: ModelSelection }): Promise<void> } | undefined, models: { id: string }[], preferred?: string | null): Promise<void>;
