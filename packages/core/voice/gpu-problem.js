/**
 * Why a GPU step failed, as a code the settings panel turns into what to do
 * next. `detail` keeps olares-cli's own words for what a code cannot explain.
 * Shared by the Host and the browser, so it imports nothing.
 *
 * @typedef {{ code: string, params: Record<string, unknown>, detail: string }} GpuProblem
 */

/** @returns {GpuProblem} */
export function gpuProblem(code, params = {}, detail = "") {
  return { code, params, detail: String(detail ?? "") };
}

const FORBIDDEN = /\b403\b|forbidden|permission denied|not (allowed|permitted)|admin(istrator)? (role )?(is )?required/i;
const LOGIN = /\b(401|459)\b|unauthori[sz]ed|invalidated|not logged in|profile login|credential (is )?(missing|absent|invalid)/i;
const BLOCKED = /bound-apps-stop-blocked/i;
const MEMORY = /out of memory|(insufficient|not enough)[^.\n]*(gpu|memory|vram)|gpu memory[^.\n]*(exceed|insufficient)/i;

/**
 * An olares-cli result → the problem the user acts on. Account and login
 * failures are fixed outside Lares, so they win over the step's own code.
 * @param {{ message?: string, text?: string }} result
 * @param {string} fallback code for this step
 */
export function cliProblem(result, fallback, params = {}) {
  const detail = String(result?.message ?? "");
  const text = `${detail}\n${result?.text ?? ""}`;
  if (FORBIDDEN.test(text)) return gpuProblem("voice_gpu_forbidden", params, detail);
  if (LOGIN.test(text)) return gpuProblem("voice_gpu_login", params, detail);
  if (BLOCKED.test(text)) return gpuProblem("voice_gpu_blocked", params, detail);
  if (MEMORY.test(text)) return gpuProblem("voice_gpu_memory", params, detail);
  return gpuProblem(fallback, params, detail);
}

/**
 * Problem → sentence in the product language. Unknown codes fall back to the
 * generic failure, which carries the CLI detail.
 * @param {(key: string, params?: Record<string, unknown>) => string} translate
 * @param {GpuProblem | null | undefined} problem
 */
export function gpuProblemText(translate, problem) {
  if (!problem?.code) return "";
  const params = { ...problem.params, detail: problem.detail || problem.code };
  const key = `error.${problem.code}`;
  const text = translate(key, params);
  return text === key ? translate("error.voice_gpu_failed", params) : text;
}
