import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { AssetStats } from "@/lib/types";

export type ShadingMode = "pbr" | "clay" | "normals";
export type LightPreset = "studio" | "sunset" | "night";

const FIT_SIZE = 2; // model is scaled so its largest side is 2 units
const HOME_DIR = new THREE.Vector3(0.62, 0.38, 0.69).normalize();
const HOME_DIST = 6.2;

/**
 * Framework-agnostic Three.js viewport. React owns the DOM node; this class owns
 * the WebGL state so re-renders never rebuild the scene.
 */
export class ModelViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
  readonly controls: OrbitControls;

  private model: THREE.Object3D | null = null;
  private wireOverlay: THREE.Group | null = null;
  private originalMats = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private clayMat = new THREE.MeshStandardMaterial({ color: 0xb9bcc6, roughness: 0.65, metalness: 0 });
  private normalMat = new THREE.MeshNormalMaterial();
  private lights = new THREE.Group();
  private envTex: THREE.Texture;
  private ro: ResizeObserver;
  private raf = 0;
  private loadToken = 0;

  shading: ShadingMode = "pbr";
  wireframe = false;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x000000, 0);
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTex;

    // Ground grid styled like the design (indigo major lines, faint minor lines).
    const grid = new THREE.GridHelper(20, 40, 0x5b5bd6, 0x232838);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.75;
    this.scene.add(grid);
    const axes = new THREE.AxesHelper(0.6);
    axes.position.y = 0.001;
    this.scene.add(axes);

    this.scene.add(this.lights);
    this.setLighting("studio");

    this.camera.position.copy(HOME_DIR).multiplyScalar(HOME_DIST);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0.8, 0);
    this.controls.autoRotateSpeed = 1.6;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 30;

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.loop();
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  // ------------------------------------------------------------ loading

  async load(url: string, format: "glb" | "fbx" = "glb"): Promise<AssetStats> {
    const token = ++this.loadToken;
    let obj: THREE.Object3D;
    if (format === "fbx") {
      obj = await new FBXLoader().loadAsync(url);
    } else {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      obj = (await loader.loadAsync(url)).scene;
    }
    if (token !== this.loadToken) return measure(obj); // a newer load won

    this.clear();
    // Some exporters (trimesh, FBX) rely on vertex colors.
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.geometry.getAttribute("color")) {
        for (const mat of ([] as THREE.Material[]).concat(m.material)) (mat as THREE.MeshStandardMaterial).vertexColors = true;
      }
      this.originalMats.set(m, m.material);
    });

    // Normalize: centre on origin, sit on the grid, fit to FIT_SIZE.
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const scale = FIT_SIZE / Math.max(size.x, size.y, size.z, 1e-6);
    obj.scale.multiplyScalar(scale);
    box.setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    obj.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));

    this.model = obj;
    this.scene.add(obj);
    this.applyShading();
    this.setWireframe(this.wireframe);
    this.resetView();
    return measure(obj);
  }

  clear() {
    if (!this.model) return;
    this.scene.remove(this.model);
    this.wireOverlay?.removeFromParent();
    this.wireOverlay = null;
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of ([] as THREE.Material[]).concat(this.originalMats.get(m) ?? [])) disposeMaterial(mat);
    });
    this.originalMats.clear();
    this.model = null;
  }

  get hasModel() {
    return !!this.model;
  }

  // ------------------------------------------------------------ view controls

  resetView() {
    const h = this.model ? new THREE.Box3().setFromObject(this.model).getSize(new THREE.Vector3()).y : 1.6;
    this.controls.target.set(0, h / 2, 0);
    this.camera.position.copy(HOME_DIR).multiplyScalar(HOME_DIST).add(this.controls.target);
    this.controls.update();
  }

  setAutoRotate(on: boolean) {
    this.controls.autoRotate = on;
  }

  setWireframe(on: boolean) {
    this.wireframe = on;
    this.wireOverlay?.removeFromParent();
    this.wireOverlay = null;
    if (!on || !this.model) return;
    const mat = new THREE.LineBasicMaterial({ color: 0x4edea3, transparent: true, opacity: 0.55 });
    const group = new THREE.Group();
    this.model.updateMatrixWorld(true);
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const lines = new THREE.LineSegments(new THREE.WireframeGeometry(m.geometry), mat);
      lines.matrixAutoUpdate = false;
      lines.matrix.copy(m.matrixWorld);
      group.add(lines);
    });
    this.wireOverlay = group;
    this.scene.add(group);
  }

  setShading(mode: ShadingMode) {
    this.shading = mode;
    this.applyShading();
  }

  private applyShading() {
    for (const [mesh, orig] of this.originalMats) {
      mesh.material = this.shading === "pbr" ? orig : this.shading === "clay" ? this.clayMat : this.normalMat;
    }
  }

  setLighting(preset: LightPreset) {
    this.lights.clear();
    const add = (l: THREE.Light, pos?: [number, number, number]) => {
      if (pos) l.position.set(...pos);
      this.lights.add(l);
    };
    if (preset === "studio") {
      this.scene.environmentIntensity = 1;
      add(new THREE.DirectionalLight(0xffffff, 1.6), [3, 5, 4]);
      add(new THREE.DirectionalLight(0xc8d4ff, 0.5), [-4, 2, -3]);
    } else if (preset === "sunset") {
      this.scene.environmentIntensity = 0.55;
      add(new THREE.DirectionalLight(0xffa066, 2.4), [-5, 2, 3]);
      add(new THREE.HemisphereLight(0xffd2a8, 0x2a1830, 0.6));
    } else {
      this.scene.environmentIntensity = 0.25;
      add(new THREE.DirectionalLight(0x8fa8ff, 1.2), [2, 4, -4]);
      add(new THREE.PointLight(0x4edea3, 6, 8), [-1.5, 1.5, 2]);
    }
  }

  // ------------------------------------------------------------ export

  /** PNG snapshot of the current frame (used as history thumbnail). */
  async snapshot(size = 320): Promise<Blob | null> {
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const s = Math.min(src.width, src.height);
    ctx.fillStyle = "#121620";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, size, size);
    return new Promise((r) => canvas.toBlob(r, "image/png"));
  }

  exportOBJ(): string | null {
    if (!this.model) return null;
    return new OBJExporter().parse(this.model);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.clear();
    this.controls.dispose();
    this.envTex.dispose();
    this.clayMat.dispose();
    this.normalMat.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function disposeMaterial(mat: THREE.Material) {
  for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
  mat.dispose();
}

export function measure(obj: THREE.Object3D): AssetStats {
  let vertices = 0;
  let triangles = 0;
  let meshes = 0;
  const mats = new Set<string>();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const g = m.geometry;
    const v = g.getAttribute("position")?.count ?? 0;
    vertices += v;
    triangles += g.index ? g.index.count / 3 : v / 3;
    for (const mat of ([] as THREE.Material[]).concat(m.material)) mats.add(mat.uuid);
  });
  return { vertices, triangles: Math.round(triangles), meshes, materials: mats.size };
}
