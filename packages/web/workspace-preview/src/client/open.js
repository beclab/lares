/**
 * Every dsh open-file surface (tool rows, produced-file chips, prose mentions,
 * the turn-tail media caption) funnels through `sidebarRight.openResource`,
 * which docks the file as a tab in the right column. Lares hides that column and
 * reads files in the conversation overlay instead, so the preview claims what it
 * can serve before the column sees the address.
 *
 * Only a session-scoped address for the mounted conversation is a candidate: a
 * tab acting on another session, and every non-file resource, belong to the
 * column. Overlay source (`/app/packages/…`) is swallowed: it is not a user
 * file. A declined address — a directory, or a path that is not a workspace
 * file — goes on to the column, which owns its own failure.
 */
import {
  interceptOpenPath,
  parseSessionFileAddress,
} from "@olares/lares-core/files/preview-workspace";

export function installPathOpener(ctx, workspace) {
  ctx.inject(["sidebarRight"], (scope) => {
    scope.effect(() => {
      const sidebar = scope.sidebarRight;
      const openNative = sidebar.openResource.bind(sidebar);
      sidebar.openResource = (address, options) => {
        const open = () => openNative(address, options);
        const target = parseSessionFileAddress(address);
        if (target === null) {
          open();
          return;
        }
        void interceptOpenPath(workspace, target, open);
      };
      return () => {
        delete sidebar.openResource;
      };
    }, "lares-file-preview-open");
  });
}
