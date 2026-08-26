/** @param {NodeJS.ProcessEnv} [env] */
export function workspaceRootFromEnv(env = process.env) {
  const value = env.DSH_CWD ?? env.LARES_WORKSPACE;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function workspaceRootFromSession(exec, env = process.env) {
  const cwd = exec?.agent?.session?.header?.cwd ?? workspaceRootFromEnv(env);
  if (cwd === null || cwd === undefined || cwd === "") {
    throw new Error("no session workspace to fetch into");
  }
  return cwd;
}
