import type { Object3D } from "three";

/**
 * Render a small PNG of a model without a visible viewport (used by Batch for thumbnails).
 * One shared offscreen renderer, so many items don't exhaust WebGL contexts.
 */
let shared: Promise<{
  THREE: typeof import("three");
  renderer: import("three").WebGLRenderer;
  env: import("three").Texture;
}> | null = null;

function setup(size: number) {
  shared ??= (async () => {
    const THREE = await import("three");
    const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
    const canvas = document.createElement("canvas");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
    renderer.setSize(size, size, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    return { THREE, renderer, env };
  })();
  return shared;
}

export async function renderThumb(model: Object3D, size = 320): Promise<Blob | null> {
  try {
    const { THREE, renderer, env } = await setup(size);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#121620");
    scene.environment = env;
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 4);
    scene.add(key, new THREE.HemisphereLight(0xffffff, 0x223344, 0.6));

    const clone = model.clone(true);
    scene.add(clone);
    const box = new THREE.Box3().setFromObject(clone);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.01);
    const camera = new THREE.PerspectiveCamera(35, 1, radius / 100, radius * 100);
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(35 / 2)) * 1.05;
    camera.position.copy(center).add(new THREE.Vector3(1, 0.75, 1.25).normalize().multiplyScalar(dist));
    camera.lookAt(center);
    renderer.render(scene, camera);
    scene.remove(clone);
    return await new Promise((r) => renderer.domElement.toBlob(r, "image/png"));
  } catch {
    return null;
  }
}

/** Load a stored model file (GLB/FBX) into an Object3D, for thumbnails of downloaded results. */
export async function loadModel(url: string, format: "glb" | "fbx"): Promise<Object3D> {
  const buf = await (await fetch(url)).arrayBuffer();
  if (format === "fbx") {
    const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
    return new FBXLoader().parse(buf, "");
  }
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  return new Promise((res, rej) => new GLTFLoader().parse(buf, "", (g) => res(g.scene), rej));
}
