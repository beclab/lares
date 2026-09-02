import {
  AmbientLight,
  Box3,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { modelFileExtension } from "./extension.js";

const sessions = new WeakMap();

function fit(root, camera, controls) {
  const box = new Box3().setFromObject(root);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const span = Math.max(size.x, size.y, size.z, 0.001);
  camera.position.set(center.x + span * 1.15, center.y + span * 0.7, center.z + span * 1.15);
  camera.near = span / 100;
  camera.far = span * 100;
  camera.updateProjectionMatrix();
  camera.lookAt(center);
  controls.target.copy(center);
  controls.update();
}

function disposeObject(root) {
  root.traverse((child) => {
    child.geometry?.dispose?.();
    const material = child.material;
    if (!material) return;
    const list = Array.isArray(material) ? material : [material];
    for (const item of list) {
      for (const value of Object.values(item)) {
        if (value && typeof value === "object" && "isTexture" in value) value.dispose();
      }
      item.dispose?.();
    }
  });
}

function overlay(host, className, text) {
  const node = document.createElement("div");
  node.className = className;
  node.textContent = text;
  host.append(node);
  return node;
}

async function loadRoot(src, title) {
  const ext = modelFileExtension(src, title);
  if (ext === ".obj") return new OBJLoader().loadAsync(src);
  if (ext === ".glb" || ext === ".gltf") {
    const gltf = await new GLTFLoader().loadAsync(src);
    return gltf.scene;
  }
  throw new Error("unsupported 3d type");
}

export function mountModel3d(host, { src, title, compact, messages }) {
  unmountModel3d(host);
  const status = overlay(host, "lares-model3d-overlay", messages.loading);

  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 1, 0.1, 1000);
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = "lares-model3d-canvas";
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.append(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = !compact;

  scene.add(new AmbientLight(0xffffff, 0.7));
  const key = new DirectionalLight(0xffffff, 0.85);
  key.position.set(2, 3, 4);
  scene.add(key);

  const session = {
    dead: false,
    frame: 0,
    width: 0,
    height: 0,
    scene,
    renderer,
    controls,
    root: null,
  };
  sessions.set(host, session);

  function paint() {
    if (session.dead) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    if (width !== session.width || height !== session.height) {
      session.width = width;
      session.height = height;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    controls.update();
    renderer.render(scene, camera);
    if (!session.dead) session.frame = requestAnimationFrame(paint);
  }

  void loadRoot(src, title).then((root) => {
    if (session.dead) {
      disposeObject(root);
      return;
    }
    session.root = root;
    scene.add(root);
    fit(root, camera, controls);
    status.remove();
    if (!compact) overlay(host, "lares-model3d-hint", messages.hint);
  }).catch(() => {
    if (session.dead) return;
    status.classList.add("is-error");
    status.textContent = messages.failed;
  });

  paint();
}

export function unmountModel3d(host) {
  const session = sessions.get(host);
  if (!session) {
    host.replaceChildren();
    return;
  }
  session.dead = true;
  cancelAnimationFrame(session.frame);
  session.controls.dispose();
  if (session.root) {
    session.scene.remove(session.root);
    disposeObject(session.root);
  }
  session.renderer.dispose();
  session.renderer.forceContextLoss?.();
  sessions.delete(host);
  host.replaceChildren();
}
