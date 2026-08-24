/**
 * Every dsh open-file surface (tool rows, produced-file chips, prose mentions)
 * funnels through `workspaces.openPath`, which hands the path to the Host's
 * desktop opener. This deployment is a headless container with no desktop, so
 * the preview claims what it can serve. A declined target — no bound session, or
 * a path that is not a workspace file, such as the produced-files row's folder —
 * keeps the native path, and its failure stays the Host's to report.
 */
export function installPathOpener(ctx, workspace) {
  ctx.inject(["workspaces"], (scope) => {
    scope.effect(() => {
      const workspaces = scope.workspaces;
      const openNative = workspaces.openPath;
      workspaces.openPath = async (path) => {
        if (await workspace.openCurrent(path)) return;
        await openNative.call(workspaces, path);
      };
      return () => {
        delete workspaces.openPath;
      };
    }, "lares-file-preview-open");
  });
}
