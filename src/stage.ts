import * as THREE from "three";
import { SparkRenderer } from "@sparkjsdev/spark";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Look } from "./look";
import type { LoadedScan } from "./scans";

export type XrMode = "immersive-vr" | "immersive-ar";

/** Where the exhibit starts: in front of you, at about desk height. Metres, floor at 0. */
const HOME = new THREE.Vector3(0, 0.95, -0.6);

/**
 * The scene: one exhibit (a scan at real size) on a small plinth ring, an info
 * card above it, and a video screen beside it. On a computer you orbit it with
 * the mouse; in a headset you grab it.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  readonly controls: OrbitControls;
  readonly look = new Look();
  /** Moved, turned and scaled by hands and controllers. */
  readonly exhibit = new THREE.Group();
  readonly card: THREE.Mesh;
  readonly screen: THREE.Mesh;
  readonly video = document.createElement("video");
  scan: LoadedScan | null = null;
  mode: XrMode | null = null;
  onFrame?: (frame: XRFrame | undefined, dt: number) => void;

  private spark: SparkRenderer;
  private holder = new THREE.Group();
  private floor: THREE.Group;
  private clock = new THREE.Clock();
  private cardCanvas = document.createElement("canvas");
  private cardTexture: THREE.CanvasTexture;
  private host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType("local-floor");
    host.appendChild(this.renderer.domElement);
    this.spark = new SparkRenderer({ renderer: this.renderer });
    this.scene.add(this.spark);
    this.scene.background = new THREE.Color(0x0b0d11);

    this.exhibit.position.copy(HOME);
    this.exhibit.add(this.holder);
    this.scene.add(this.exhibit);

    // Plinth ring under the exhibit, and a floor grid for VR (hidden in passthrough).
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.17, 64), new THREE.MeshBasicMaterial({ color: 0x5ce1e6, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.name = "plinth";
    this.exhibit.add(ring);
    this.floor = new THREE.Group();
    const grid = new THREE.GridHelper(8, 32, 0x2b3542, 0x1a2029);
    this.floor.add(grid);
    this.scene.add(this.floor);

    // Info card: a canvas drawn as a texture, turned to face you every frame.
    this.cardCanvas.width = 1024;
    this.cardCanvas.height = 320;
    this.cardTexture = new THREE.CanvasTexture(this.cardCanvas);
    this.cardTexture.colorSpace = THREE.SRGBColorSpace;
    this.card = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.1), new THREE.MeshBasicMaterial({ map: this.cardTexture, transparent: true, depthWrite: false }));
    this.card.renderOrder = 10;
    this.scene.add(this.card);

    // Video screen to the right of where the exhibit starts.
    this.video.crossOrigin = "anonymous";
    this.video.loop = true;
    this.video.muted = true;
    this.video.playsInline = true;
    const vt = new THREE.VideoTexture(this.video);
    vt.colorSpace = THREE.SRGBColorSpace;
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: vt, side: THREE.DoubleSide }));
    // Beside the exhibit, angled toward where you stand (and the default desktop view).
    this.screen.position.set(0.46, 1.12, -0.68);
    this.screen.lookAt(0.12, 1.4, 0.25);
    this.screen.visible = false;
    this.screen.name = "screen";
    this.scene.add(this.screen);
    this.video.addEventListener("loadedmetadata", () => {
      const aspect = this.video.videoWidth / Math.max(1, this.video.videoHeight);
      this.screen.scale.set(aspect >= 1 ? 1 : aspect, aspect >= 1 ? 1 / aspect : 1, 1);
    });

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.camera.position.set(0.22, 1.32, 0.42);
    this.controls.target.set(0.2, 1.08, -0.62);
    this.controls.update();

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop((_t, frame) => this.tick(frame));
  }

  /** Swaps in a scan. The previous one is disposed. */
  show(scan: LoadedScan) {
    const old = this.scan;
    scan.mesh.matrixAutoUpdate = false;
    scan.mesh.matrix.copy(scan.base);
    scan.mesh.objectModifier = this.look.modifier();
    scan.mesh.updateGenerator();
    this.look.up.value.copy(scan.up);
    this.look.hMin.value = scan.hMin;
    this.look.hMax.value = scan.hMax;
    this.holder.add(scan.mesh);
    this.scan = scan;
    if (old && old !== scan) {
      this.holder.remove(old.mesh);
      old.mesh.dispose();
    }
    this.drawCard();
  }

  /** Puts the exhibit back in front of you at real size. */
  resetPlacement() {
    this.scene.attach(this.exhibit);
    this.exhibit.position.copy(HOME);
    if (this.mode) {
      // In a headset, in front of wherever you're facing.
      const head = new THREE.Vector3();
      const dir = new THREE.Vector3();
      const cam = this.renderer.xr.getCamera();
      cam.getWorldPosition(head);
      cam.getWorldDirection(dir);
      dir.y = 0;
      if (dir.lengthSq() > 1e-6) {
        dir.normalize();
        this.exhibit.position.set(head.x + dir.x * 0.6, Math.max(0.6, head.y - 0.55), head.z + dir.z * 0.6);
      }
    }
    this.exhibit.quaternion.identity();
    this.exhibit.scale.setScalar(1);
  }

  /** Repaints the info card (title, credit, look, splats). */
  drawCard(extra = "") {
    const ctx = this.cardCanvas.getContext("2d")!;
    const w = this.cardCanvas.width;
    const h = this.cardCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(11, 13, 17, 0.82)";
    roundRect(ctx, 0, 0, w, h, 36);
    ctx.fill();
    ctx.strokeStyle = "rgba(92, 225, 230, 0.6)";
    ctx.lineWidth = 3;
    ctx.stroke();
    const s = this.scan;
    ctx.fillStyle = "#e8edf2";
    ctx.font = "600 56px Geist, system-ui, sans-serif";
    ctx.fillText(fit(ctx, s?.info.title ?? "No scan", w - 80), 40, 92);
    ctx.fillStyle = "#a9b4bf";
    ctx.font = "40px Geist, system-ui, sans-serif";
    ctx.fillText(fit(ctx, s ? `${s.info.byline} · ${s.info.licence}` : "", w - 80), 40, 160);
    ctx.font = "36px 'Geist Mono', ui-monospace, monospace";
    ctx.fillStyle = "#5ce1e6";
    ctx.fillText(fit(ctx, extra, w - 80), 40, 250);
    this.cardTexture.needsUpdate = true;
  }

  async enterXr(mode: XrMode) {
    const session = await navigator.xr!.requestSession(mode, {
      requiredFeatures: ["local-floor"],
      optionalFeatures: ["hand-tracking", "bounded-floor"],
    });
    const ar = mode === "immersive-ar";
    this.scene.background = ar ? null : new THREE.Color(0x0b0d11);
    this.floor.visible = !ar;
    this.renderer.setClearColor(0x000000, ar ? 0 : 1);
    // Lower detail at the edges of each eye's view: cheaper, hard to notice.
    this.renderer.xr.setFoveation(1);
    await this.renderer.xr.setSession(session);
    this.mode = mode;
    // The head pose isn't known until the headset has drawn a frame or two, and
    // placing the exhibit needs it.
    for (let i = 0; i < 2; i++) await new Promise<void>((r) => session.requestAnimationFrame(() => r()));
    session.addEventListener("end", () => {
      this.mode = null;
      this.scene.background = new THREE.Color(0x0b0d11);
      this.floor.visible = true;
      this.renderer.setClearColor(0x000000, 1);
    });
  }

  private resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h || this.renderer.xr.isPresenting) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private tick(frame?: XRFrame) {
    const dt = this.clock.getDelta();
    this.look.time.value += dt;
    if (this.scan && this.look.holo.value > 0.5) this.scan.mesh.updateVersion();
    if (!this.renderer.xr.isPresenting) this.controls.update();
    this.onFrame?.(frame, dt);

    // Card floats above the exhibit and turns to face you.
    if (this.scan) {
      const top = new THREE.Vector3(0, this.scan.height + 0.09, 0);
      this.exhibit.localToWorld(top);
      this.card.position.copy(top);
      const eye = new THREE.Vector3();
      (this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera).getWorldPosition(eye);
      this.card.lookAt(eye.x, top.y, eye.z);
    }
    this.renderer.render(this.scene, this.camera);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > width) t = t.slice(0, -1);
  return t + "…";
}
