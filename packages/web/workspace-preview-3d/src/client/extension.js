import { posixExtname } from "@olares/lares-core/files/filename";

/**
 * Extension of the mesh file, not of a dotted directory in its path
 * (`outputs/v1.2/mesh.glb` → `.glb`).
 */
export function modelFileExtension(src, title) {
  const fromTitle = posixExtname(title).toLowerCase();
  if (fromTitle) return fromTitle;
  try {
    const url = new URL(src, "http://x");
    return posixExtname(url.searchParams.get("path") || url.pathname).toLowerCase();
  } catch {
    return posixExtname(src).toLowerCase();
  }
}
