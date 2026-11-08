import * as THREE from "three";
import type { Stage } from "./stage";
import { WristMenu, type MenuButton } from "./wristMenu";

export interface InputActions {
  prevScan(): void;
  nextScan(): void;
  cycleLook(): void;
  toggleAuto(): void;
  /** Play or pause the video on the screen. */
  toggleVideo(): void;
  /** Show the video screen beside you (starting a clip if none), or hide it. */
  videoPanel(): void;
  reset(): void;
  exit(): void;
  /** The wrist menu's buttons as they should look now. */
  menu(): MenuButton[];
}

const NEAR = 0.15; // metres beyond the exhibit's own radius that still counts as "in reach"
const FAR = 6;
const WALK = 1.2; // m/s with the left stick in a space
const SNAP = Math.PI / 6; // 30° snap turn

/**
 * Headset input, for Touch controllers and hand tracking alike (a pinch is a
 * "select" in WebXR, so the same code handles both):
 *
 * - Turn your left palm toward you: the wrist menu (scans, look, Auto, reset,
 *   video, exit). Poke it with your right index finger, or point and pinch/trigger.
 * - Objects: grip, trigger or pinch on the exhibit, near or pointing at it, to
 *   grab it. It follows your hand, so you can turn it in your hand. Both hands:
 *   pull apart or together to scale.
 * - Spaces: grab anywhere and pull to move through it. Both hands: turn and scale it.
 *   Left stick walks, right stick snap-turns.
 * - Video: trigger or pinch on the screen plays or pauses; grip on it moves it.
 * - Buttons: right A next scan, right B colour or hologram, right stick click Auto,
 *   left X put it back, left Y video. Right stick on an object: turn and scale it.
 */
export class XrInput {
  readonly menu: WristMenu;
  private controllers: THREE.Group[] = [];
  private rays: THREE.Line[] = [];
  private sources = new Map<THREE.Group, XRInputSource>();
  private grabbing: THREE.Group[] = [];
  private twoHand: { d0: number; s0: number } | null = null;
  /** Spaces: the exhibit and hand positions when the current grab started. */
  private world: { e0: THREE.Matrix4; p0: THREE.Vector3[] } | null = null;
  private screenHolder: THREE.Group | null = null;
  private pressed = new Map<string, boolean>();
  private snapArmed = true;
  private raycaster = new THREE.Raycaster();
  private gripMatrix = new THREE.Matrix4();

  constructor(
    private stage: Stage,
    private actions: InputActions,
  ) {
    this.menu = new WristMenu(stage.scene);
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
      c.addEventListener("connected", (e) => this.sources.set(c, (e as unknown as { data: XRInputSource }).data));
      c.addEventListener("disconnected", () => {
        this.end(c);
        this.sources.delete(c);
      });
      c.addEventListener("selectstart", () => this.start(c, true));
      c.addEventListener("selectend", () => this.end(c));
      c.addEventListener("squeezestart", () => this.start(c, false));
      c.addEventListener("squeezeend", () => this.end(c));
      stage.scene.add(c);
      this.controllers.push(c);
      this.rays.push(ray);
    }
  }

  private get space() {
    return this.stage.scan?.info.kind === "space";
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

  /** Distance along the controller's ray to the exhibit, or 0 if in reach; null if neither. Aims the raycaster. */
  private reach(c: THREE.Group): number | null {
    const origin = this.aim(c);
    if (this.space) return null; // you stand inside a space
    const sphere = this.exhibitSphere();
    const d = origin.distanceTo(sphere.center);
    if (d <= sphere.radius + NEAR) return 0;
    const hit = this.raycaster.ray.intersectSphere(sphere, new THREE.Vector3());
    return hit ? origin.distanceTo(hit) : null;
  }

  private isLeft(c: THREE.Group) {
    return this.sources.get(c)?.handedness === "left";
  }

  /** A short buzz on a controller (hands have no motors). */
  private buzz(c: THREE.Group | null, strength = 0.35, ms = 25) {
    const gp = c ? this.sources.get(c)?.gamepad : undefined;
    const h = (gp as unknown as { hapticActuators?: { pulse?: (v: number, ms: number) => void }[] })?.hapticActuators?.[0];
    h?.pulse?.(strength, ms);
  }

  private press(id: string, c: THREE.Group | null) {
    this.menu.pressed(id, performance.now());
    this.buzz(c);
    const a = this.actions;
    const map: Record<string, () => void> = {
      prev: a.prevScan,
      next: a.nextScan,
      look: a.cycleLook,
      auto: a.toggleAuto,
      reset: a.reset,
      video: a.videoPanel,
      exit: a.exit,
    };
    map[id]?.();
  }

  private start(c: THREE.Group, isSelect: boolean) {
    const toExhibit = this.reach(c);
    // The wrist menu comes first (pointing at it with the other hand).
    if (!this.isLeft(c)) {
      const b = this.menu.rayButton(this.raycaster);
      if (b) {
        if (isSelect) this.press(b.id, c);
        return;
      }
    }
    if (this.stage.screen.visible) {
      const hit = this.raycaster.intersectObject(this.stage.screen)[0];
      if (hit && (toExhibit === null || hit.distance < toExhibit)) {
        if (isSelect) this.actions.toggleVideo();
        else if (!this.screenHolder) {
          // Grip on the screen: carry it.
          c.attach(this.stage.screen);
          this.screenHolder = c;
          this.buzz(c, 0.2, 15);
        }
        return;
      }
    }
    if (this.grabbing.includes(c) || this.grabbing.length >= 2) return;
    if (this.space) {
      this.grabbing.push(c);
      this.snapshotWorld();
      return;
    }
    if (toExhibit === null) return;
    this.buzz(c, 0.2, 15);
    if (this.grabbing.length === 0) {
      c.attach(this.stage.exhibit);
      this.grabbing = [c];
    } else {
      this.grabbing.push(c);
      const [a, b] = this.grabbing;
      this.twoHand = {
        d0: a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3())),
        s0: this.stage.exhibit.scale.x,
      };
    }
  }

  private end(c: THREE.Group) {
    if (this.screenHolder === c) {
      this.stage.scene.attach(this.stage.screen);
      this.screenHolder = null;
    }
    const i = this.grabbing.indexOf(c);
    if (i < 0) return;
    this.grabbing.splice(i, 1);
    this.twoHand = null;
    if (this.space) {
      this.snapshotWorld();
      return;
    }
    this.stage.scene.attach(this.stage.exhibit);
    // If the other hand is still holding it, it carries on from there.
    if (this.grabbing.length === 1) this.grabbing[0].attach(this.stage.exhibit);
  }

  /** Spaces: remember where things were when the set of grabbing hands changed. */
  private snapshotWorld() {
    const e = this.stage.exhibit;
    e.updateMatrix();
    this.world = this.grabbing.length
      ? { e0: e.matrix.clone(), p0: this.grabbing.map((g) => g.getWorldPosition(new THREE.Vector3())) }
      : null;
  }

  /**
   * Spaces: one hand pulls the world along (you move the other way); two hands
   * also turn it about the vertical and scale it, around the point between them.
   */
  private dragWorld() {
    const w = this.world;
    if (!w || !this.grabbing.length) return;
    const p = this.grabbing.map((g) => g.getWorldPosition(new THREE.Vector3()));
    const m = new THREE.Matrix4();
    if (p.length === 1) {
      m.makeTranslation(p[0].clone().sub(w.p0[0]));
    } else {
      const mid0 = w.p0[0].clone().add(w.p0[1]).multiplyScalar(0.5);
      const mid = p[0].clone().add(p[1]).multiplyScalar(0.5);
      const v0 = w.p0[1].clone().sub(w.p0[0]);
      const v = p[1].clone().sub(p[0]);
      const angle = Math.atan2(v.x, v.z) - Math.atan2(v0.x, v0.z);
      const s0 = new THREE.Vector3().setFromMatrixScale(w.e0).x;
      const k = THREE.MathUtils.clamp(v.length() / Math.max(0.02, v0.length()), 0.05 / s0, 20 / s0);
      m.makeTranslation(mid)
        .multiply(new THREE.Matrix4().makeRotationY(angle))
        .multiply(new THREE.Matrix4().makeScale(k, k, k))
        .multiply(new THREE.Matrix4().makeTranslation(mid0.negate()));
    }
    m.multiply(w.e0);
    const e = this.stage.exhibit;
    m.decompose(e.position, e.quaternion, e.scale);
  }

  /** Spaces: turns the world about the vertical through your head. */
  private turnWorld(angle: number, head: THREE.Vector3) {
    const e = this.stage.exhibit;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    e.position.sub(head).applyQuaternion(q).add(head);
    e.quaternion.premultiply(q);
  }

  /** Called every frame while in a headset. */
  update(frame: XRFrame | undefined, dt: number) {
    const xr = this.stage.renderer.xr;
    const session = xr.getSession();
    const ref = xr.getReferenceSpace();
    if (!frame || !session || !ref) return;
    const cam = xr.getCamera();
    const head = cam.getWorldPosition(new THREE.Vector3());

    // Poses straight from the frame: the left grip (palm) and the right index fingertip.
    let leftGrip: THREE.Matrix4 | null = null;
    let tip: THREE.Vector3 | null = null;
    for (const src of session.inputSources) {
      if (src.handedness === "left" && src.gripSpace) {
        const pose = frame.getPose(src.gripSpace, ref);
        if (pose) leftGrip = this.gripMatrix.fromArray(pose.transform.matrix);
      }
      if (src.handedness === "right" && src.hand) {
        const joint = src.hand.get("index-finger-tip");
        const pose = joint && frame.getJointPose ? frame.getJointPose(joint, ref) : null;
        if (pose) tip = new THREE.Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
      }
    }
    const leftBusy = this.grabbing.some((g) => this.isLeft(g)) || (this.screenHolder !== null && this.isLeft(this.screenHolder));
    this.menu.place(leftGrip, head, leftBusy);
    if (this.menu.visible) {
      // Hover from the right ray, then the fingertip (which wins when it's close).
      const right = this.controllers.find((c) => !this.isLeft(c) && this.sources.has(c));
      if (right) this.aim(right);
      this.menu.setHover(right ? (this.menu.rayButton(this.raycaster)?.id ?? null) : null);
      const poked = this.menu.poke(tip);
      if (poked) this.press(poked, null);
      this.menu.setButtons(this.actions.menu(), performance.now());
    } else {
      this.menu.poke(null);
    }

    if (this.space) this.dragWorld();
    else if (this.grabbing.length === 2 && this.twoHand) {
      // Two-handed scale: the exhibit grows or shrinks with the gap between your hands.
      const [a, b] = this.grabbing;
      const d = a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3()));
      const s = THREE.MathUtils.clamp((this.twoHand.s0 * d) / Math.max(0.02, this.twoHand.d0), 0.1, 10);
      this.stage.exhibit.scale.setScalar(s);
    }

    // Rays: show how far each one reaches, brighter when it's on something.
    this.controllers.forEach((c, i) => {
      const toExhibit = this.reach(c);
      const onMenu = !this.isLeft(c) ? this.menu.rayButton(this.raycaster)?.distance : undefined;
      const onScreen = this.stage.screen.visible ? this.raycaster.intersectObject(this.stage.screen)[0]?.distance : undefined;
      const hit = Math.min(toExhibit ?? Infinity, onScreen ?? Infinity, onMenu ?? Infinity);
      this.rays[i].scale.z = Number.isFinite(hit) ? Math.max(0.05, hit) : 0.3;
      (this.rays[i].material as THREE.LineBasicMaterial).opacity = Number.isFinite(hit) ? 0.95 : 0.35;
      // While you poke the menu with a finger, the right ray would only be in the way.
      this.rays[i].visible = !(this.menu.visible && this.menu.tip.visible && !this.isLeft(c));
    });

    // Controller buttons (xr-standard mapping: 3 = stick click, 4 = A/X, 5 = B/Y; axes 2, 3 = thumbstick).
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
      const x = gp.axes[2] ?? 0;
      const y = gp.axes[3] ?? 0;
      if (side === "right") {
        edge(4, this.actions.nextScan);
        edge(5, this.actions.cycleLook);
        edge(3, this.actions.toggleAuto);
        if (this.space) {
          // Snap turn: one step per push of the stick.
          if (Math.abs(x) > 0.7 && this.snapArmed) {
            this.turnWorld(Math.sign(x) * SNAP, head); // stick right: you turn right, the world turns left
            this.snapArmed = false;
            this.snapshotWorld();
          } else if (Math.abs(x) < 0.3) this.snapArmed = true;
        } else if (this.grabbing.length === 0) {
          if (Math.abs(x) > 0.2) this.stage.exhibit.rotateY(-x * dt * 2);
          if (Math.abs(y) > 0.2) this.stage.exhibit.scale.multiplyScalar(THREE.MathUtils.clamp(1 - y * dt * 1.5, 0.5, 1.5));
          const s = THREE.MathUtils.clamp(this.stage.exhibit.scale.x, 0.1, 10);
          this.stage.exhibit.scale.setScalar(s);
        }
      } else if (side === "left") {
        edge(4, this.actions.reset);
        edge(5, this.actions.videoPanel);
        if (this.space && (Math.abs(x) > 0.2 || Math.abs(y) > 0.2)) {
          // Walk where you're looking: the world slides the other way.
          const fwd = cam.getWorldDirection(new THREE.Vector3());
          fwd.y = 0;
          if (fwd.lengthSq() > 1e-6) {
            fwd.normalize();
            const rightDir = new THREE.Vector3(-fwd.z, 0, fwd.x);
            const move = rightDir.multiplyScalar(x).addScaledVector(fwd, -y).multiplyScalar(WALK * dt);
            this.stage.exhibit.position.sub(move);
            this.snapshotWorld();
          }
        }
      }
    }
  }

  /** Lets go of everything (e.g. when the session ends or the scan changes). */
  releaseAll() {
    this.grabbing = [];
    this.twoHand = null;
    this.world = null;
    this.stage.scene.attach(this.stage.exhibit);
    if (this.screenHolder) {
      this.stage.scene.attach(this.stage.screen);
      this.screenHolder = null;
    }
  }
}
