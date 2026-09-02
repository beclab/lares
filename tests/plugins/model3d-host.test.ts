import assert from "node:assert/strict";
import test from "node:test";
import {
  attachModel3dHost,
  attachedModel3dHosts,
  subscribeModel3dHost,
} from "../../packages/web/shared/client/model3d-host.js";
import { modelFileExtension } from "../../packages/web/workspace-preview-3d/src/client/extension.js";

test("model3d host replays live mounts to a late subscriber", () => {
  const node = { id: "host" };
  const seen = [];
  const detach = attachModel3dHost(node, { src: "/raw?path=a.glb", title: "a.glb", compact: true });
  const stop = subscribeModel3dHost((event) => seen.push(event));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, "attach");
  assert.equal(seen[0].node, node);
  assert.equal(seen[0].src, "/raw?path=a.glb");
  detach();
  assert.equal(seen.at(-1)?.type, "detach");
  stop();
});

test("unsubscribing a 3d viewer does not drop the chrome seat", () => {
  const node = { id: "keep" };
  const detach = attachModel3dHost(node, { src: "/raw?path=b.glb", title: "b.glb", compact: false });
  const stop = subscribeModel3dHost(() => {});
  stop();
  assert.deepEqual(attachedModel3dHosts(), [node]);
  detach();
  assert.deepEqual(attachedModel3dHosts(), []);
});

test("model3d host seat is shared across separate module instances", async () => {
  const chrome = await import(`../../packages/web/shared/client/model3d-host.js?chrome=${Date.now()}`);
  const viewer = await import(`../../packages/web/shared/client/model3d-host.js?viewer=${Date.now()}`);
  assert.notEqual(chrome, viewer);
  const node = { id: "cross-bundle" };
  const seen = [];
  const stop = viewer.subscribeModel3dHost((event) => seen.push(event));
  const detach = chrome.attachModel3dHost(node, { src: "/raw?path=c.glb", title: "c.glb", compact: true });
  assert.equal(seen.at(-1)?.type, "attach");
  assert.equal(seen.at(-1)?.node, node);
  assert.deepEqual(viewer.attachedModel3dHosts(), [node]);
  detach();
  assert.equal(seen.at(-1)?.type, "detach");
  stop();
});

test("modelFileExtension reads the basename, not a dotted directory", () => {
  assert.equal(modelFileExtension("/raw?path=outputs/mesh.glb", "outputs/v1.2/mesh.glb"), ".glb");
  assert.equal(modelFileExtension("/raw?path=outputs/v1.2/mesh.glb", "outputs/v1.2/mesh"), ".glb");
  assert.equal(modelFileExtension("/raw?path=scene.GLTF", ""), ".gltf");
  assert.equal(modelFileExtension("/raw?path=cad.obj", "cad.obj"), ".obj");
});
