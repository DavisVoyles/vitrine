import * as THREE from "three";
import type { Stage } from "./stage";

export interface InputActions {
  nextScan(): void;
  cycleLook(): void;
  toggleVideo(): void;
  reset(): void;
}

const NEAR = 0.15; // metres beyond the exhibit's own radius that still counts as "in reach"
const FAR = 6;

/**
 * Headset input, for Touch controllers and hand tracking alike (a pinch is a
 * "select" in WebXR, so the same code handles both):
 *
 * - Grip, trigger or pinch on the exhibit, near or pointing at it: grab it.
 *   It follows your hand, keeping its offset, so you can turn it in your hand.
 * - Grab with both hands and pull apart or together: scale it.
 * - Trigger or pinch on the video screen: play or pause.
 * - Right A: next scan. Right B: next look. Left X: put it back in front of you.
 *   Left Y: show or hide the video. Right thumbstick: turn (left/right) and
 *   scale (up/down) without grabbing.
 */
export class XrInput {
  private controllers: THREE.Group[] = [];
  private rays: THREE.Line[] = [];
  private grabbing: THREE.Group[] = [];
  private twoHand: { d0: number; s0: number } | null = null;
  private pressed = new Map<string, boolean>();
  private raycaster = new THREE.Raycaster();

  constructor(
    private stage: Stage,
    private actions: InputActions,
  ) {
    const xr = stage.renderer.xr;
    for (let i = 0; i < 2; i++) {
      const c = xr.getController(i);
      const ray = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0x5ce1e6, transparent: true, opacity: 0.7 }),
      );
      ray.scale.z = 0.3;
      ray.frustumCulled = false;
      c.add(ray);
      c.addEventListener("selectstart", () => this.start(c, true));
      c.addEventListener("selectend", () => this.end(c));
      c.addEventListener("squeezestart", () => this.start(c, false));
      c.addEventListener("squeezeend", () => this.end(c));
      c.addEventListener("disconnected", () => this.end(c));
      stage.scene.add(c);
      this.controllers.push(c);
      this.rays.push(ray);
    }
  }

  /** World-space centre and radius of the exhibit as it is now (moved and scaled). */
  private exhibitSphere() {
    const s = this.stage.scan;
    const e = this.stage.exhibit;
    const centre = e.localToWorld(new THREE.Vector3(0, (s?.height ?? 0.3) / 2, 0));
    const scale = e.getWorldScale(new THREE.Vector3()).x;
    return new THREE.Sphere(centre, (s?.radius ?? 0.2) * scale);
  }

  private aim(c: THREE.Group) {
    const origin = c.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(c.getWorldQuaternion(new THREE.Quaternion()));
    this.raycaster.set(origin, dir);
    this.raycaster.far = FAR;
    return origin;
  }

  /** Distance along the controller's ray to the exhibit, or to it if in reach; null if neither. */
  private reach(c: THREE.Group): number | null {
    const origin = this.aim(c);
    const sphere = this.exhibitSphere();
    const d = origin.distanceTo(sphere.center);
    if (d <= sphere.radius + NEAR) return 0;
    const hit = this.raycaster.ray.intersectSphere(sphere, new THREE.Vector3());
    return hit ? origin.distanceTo(hit) : null;
  }

  private start(c: THREE.Group, isSelect: boolean) {
    const toExhibit = this.reach(c);
    if (isSelect && this.stage.screen.visible) {
      const hit = this.raycaster.intersectObject(this.stage.screen)[0];
      if (hit && (toExhibit === null || hit.distance < toExhibit)) {
        this.actions.toggleVideo();
        return;
      }
    }
    if (toExhibit === null || this.grabbing.includes(c)) return;
    if (this.grabbing.length === 0) {
      c.attach(this.stage.exhibit);
      this.grabbing = [c];
    } else if (this.grabbing.length === 1) {
      this.grabbing.push(c);
      const [a, b] = this.grabbing;
      this.twoHand = {
        d0: a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3())),
        s0: this.stage.exhibit.scale.x,
      };
    }
  }

  private end(c: THREE.Group) {
    const i = this.grabbing.indexOf(c);
    if (i < 0) return;
    this.grabbing.splice(i, 1);
    this.twoHand = null;
    const scene = this.stage.scene;
    scene.attach(this.stage.exhibit);
    // If the other hand is still holding it, it carries on from there.
    if (this.grabbing.length === 1) this.grabbing[0].attach(this.stage.exhibit);
  }

  /** Called every frame while in a headset. */
  update(frame: XRFrame | undefined, dt: number) {
    const session = this.stage.renderer.xr.getSession();
    if (!frame || !session) return;

    // Two-handed scale: the exhibit grows or shrinks with the gap between your hands.
    if (this.grabbing.length === 2 && this.twoHand) {
      const [a, b] = this.grabbing;
      const d = a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3()));
      const s = THREE.MathUtils.clamp((this.twoHand.s0 * d) / Math.max(0.02, this.twoHand.d0), 0.1, 10);
      this.stage.exhibit.scale.setScalar(s);
    }

    // Rays: show how far each one reaches, brighter when it's on something.
    this.controllers.forEach((c, i) => {
      const toExhibit = this.reach(c);
      const onScreen = this.stage.screen.visible ? this.raycaster.intersectObject(this.stage.screen)[0]?.distance : undefined;
      const hit = Math.min(toExhibit ?? Infinity, onScreen ?? Infinity);
      this.rays[i].scale.z = Number.isFinite(hit) ? Math.max(0.05, hit) : 0.3;
      (this.rays[i].material as THREE.LineBasicMaterial).opacity = Number.isFinite(hit) ? 0.95 : 0.35;
    });

    // Controller buttons (xr-standard mapping: 4 = A/X, 5 = B/Y; axes 2, 3 = thumbstick).
    for (const src of session.inputSources) {
      const gp = src.gamepad;
      if (!gp || src.hand) continue;
      const side = src.handedness;
      const edge = (index: number, fn: () => void) => {
        const key = `${side}-${index}`;
        const down = !!gp.buttons[index]?.pressed;
        if (down && !this.pressed.get(key)) fn();
        this.pressed.set(key, down);
      };
      if (side === "right") {
        edge(4, this.actions.nextScan);
        edge(5, this.actions.cycleLook);
        const x = gp.axes[2] ?? 0;
        const y = gp.axes[3] ?? 0;
        if (this.grabbing.length === 0) {
          if (Math.abs(x) > 0.2) this.stage.exhibit.rotateY(-x * dt * 2);
          if (Math.abs(y) > 0.2) this.stage.exhibit.scale.multiplyScalar(THREE.MathUtils.clamp(1 - y * dt * 1.5, 0.5, 1.5));
          const s = THREE.MathUtils.clamp(this.stage.exhibit.scale.x, 0.1, 10);
          this.stage.exhibit.scale.setScalar(s);
        }
      } else if (side === "left") {
        edge(4, this.actions.reset);
        edge(5, () => {
          this.stage.screen.visible = !this.stage.screen.visible && !!this.stage.video.src;
        });
      }
    }
  }

  /** Lets go of everything (e.g. when the session ends or the scan changes). */
  releaseAll() {
    this.grabbing = [];
    this.twoHand = null;
    this.stage.scene.attach(this.stage.exhibit);
  }
}
