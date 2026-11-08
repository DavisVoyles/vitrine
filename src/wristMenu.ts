import * as THREE from "three";

export interface MenuButton {
  id: string;
  label: string;
  /** Second line, e.g. the current setting. */
  sub?: string;
  /** Spans the whole row. */
  wide?: boolean;
  tone?: "accent" | "exit";
}

const W = 0.16; // metres
const H = 0.135;
const PX = 6000; // canvas pixels per metre
const COLS = 3;
const GAP = 18;
const PAD = 22;

/**
 * A small menu that floats over your left palm when you turn it toward you
 * (with a hand, or holding a Touch controller). Press a button by poking it with
 * your right index finger, or by pointing at it and pinching or pulling the trigger.
 *
 * The palm direction comes from the WebXR grip space: the back of the left hand
 * points along −X, so the palm faces +X.
 */
export class WristMenu {
  readonly mesh: THREE.Mesh;
  /** A dot on your right fingertip while it's near the menu, so you can see what you'll poke. */
  readonly tip: THREE.Mesh;
  visible = false;

  private canvas = document.createElement("canvas");
  private texture: THREE.CanvasTexture;
  private layout: (MenuButton & { x: number; y: number; w: number; h: number })[] = [];
  private drawn = "";
  private hover = -1;
  private flash = -1;
  private flashUntil = 0;
  private armed = true;
  private pos = new THREE.Vector3();
  private placed = false;

  constructor(scene: THREE.Scene) {
    this.canvas.width = Math.round(W * PX);
    this.canvas.height = Math.round(H * PX);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false }),
    );
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    this.mesh.name = "wrist-menu";
    scene.add(this.mesh);
    this.tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.006, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x5ce1e6, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this.tip.renderOrder = 21;
    this.tip.visible = false;
    scene.add(this.tip);
  }

  /** Sets the buttons; redraws only if something changed. */
  setButtons(buttons: MenuButton[], now: number) {
    const key = JSON.stringify(buttons) + `|${this.hover}|${now < this.flashUntil ? this.flash : -1}`;
    if (key === this.drawn) return;
    this.drawn = key;
    this.layout = [];
    const cw = this.canvas.width;
    const rows: MenuButton[][] = [];
    for (const b of buttons) {
      const last = rows[rows.length - 1];
      if (b.wide || !last || last.length >= COLS || last[0]?.wide) rows.push([b]);
      else last.push(b);
    }
    const rowH = (this.canvas.height - PAD * 2 - GAP * (rows.length - 1)) / rows.length;
    rows.forEach((row, r) => {
      const n = row[0].wide ? 1 : COLS;
      const bw = (cw - PAD * 2 - GAP * (n - 1)) / n;
      row.forEach((b, c) => this.layout.push({ ...b, x: PAD + c * (bw + GAP), y: PAD + r * (rowH + GAP), w: bw, h: rowH }));
    });
    this.draw(now);
  }

  private draw(now: number) {
    const ctx = this.canvas.getContext("2d")!;
    const { width: w, height: h } = this.canvas;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(11, 13, 17, 0.9)";
    roundRect(ctx, 0, 0, w, h, 40);
    ctx.fill();
    ctx.strokeStyle = "rgba(92, 225, 230, 0.55)";
    ctx.lineWidth = 4;
    ctx.stroke();
    this.layout.forEach((b, i) => {
      const lit = i === this.flash && now < this.flashUntil;
      const exit = b.tone === "exit";
      ctx.fillStyle = lit ? "#5ce1e6" : exit ? "#3a1d22" : i === this.hover ? "#26303c" : "#171c24";
      roundRect(ctx, b.x, b.y, b.w, b.h, 26);
      ctx.fill();
      ctx.strokeStyle = b.tone === "accent" ? "#5ce1e6" : exit ? "#ff8a8a" : i === this.hover ? "#808c98" : "#2c3642";
      ctx.lineWidth = b.tone ? 5 : 3;
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillStyle = lit ? "#061214" : exit ? "#ffd6d6" : "#e8edf2";
      ctx.font = `600 ${b.sub ? 46 : 52}px Geist, system-ui, sans-serif`;
      const cx = b.x + b.w / 2;
      ctx.fillText(b.label, cx, b.y + b.h / 2 + (b.sub ? -6 : 18));
      if (b.sub) {
        ctx.fillStyle = lit ? "#061214" : "#a9b4bf";
        ctx.font = "36px 'Geist Mono', ui-monospace, monospace";
        ctx.fillText(b.sub, cx, b.y + b.h / 2 + 42);
      }
    });
    this.texture.needsUpdate = true;
  }

  /**
   * Places the menu over the left palm and shows it while the palm faces your
   * head. `grip` is the left grip pose (null if not tracked); `blocked` hides it
   * (e.g. while the left hand is holding something).
   */
  place(grip: THREE.Matrix4 | null, head: THREE.Vector3, blocked: boolean) {
    let show = false;
    if (grip && !blocked) {
      const palm = new THREE.Vector3().setFromMatrixPosition(grip);
      const normal = new THREE.Vector3().setFromMatrixColumn(grip, 0).normalize(); // grip +X = left palm
      const toHead = head.clone().sub(palm).normalize();
      const facing = normal.dot(toHead);
      // Hysteresis, so it doesn't flicker at the edge.
      show = facing > (this.visible ? 0.3 : 0.55);
      if (show) {
        const target = palm
          .clone()
          .addScaledVector(normal, 0.05)
          .addScaledVector(toHead, 0.04)
          .add(new THREE.Vector3(0, 0.07, 0));
        // Hand tracking jitters a little: follow smoothly, but jump when first shown.
        if (!this.placed || !this.visible) this.pos.copy(target);
        else this.pos.lerp(target, 0.35);
        this.placed = true;
        this.mesh.position.copy(this.pos);
        this.mesh.lookAt(head);
      }
    }
    if (!show) {
      this.hover = -1;
      this.tip.visible = false;
    }
    this.visible = show;
    this.mesh.visible = show;
  }

  /** Which button a point on the menu's face (uv, 0–1) is on, or −1. */
  private at(uv: THREE.Vector2) {
    const x = uv.x * this.canvas.width;
    const y = (1 - uv.y) * this.canvas.height;
    return this.layout.findIndex((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  }

  /** Button under a ray, for hover and for presses by pointing. */
  rayButton(ray: THREE.Raycaster): { id: string; distance: number } | null {
    if (!this.visible) return null;
    const hit = ray.intersectObject(this.mesh)[0];
    if (!hit?.uv) return null;
    const i = this.at(hit.uv);
    return i >= 0 ? { id: this.layout[i].id, distance: hit.distance } : null;
  }

  setHover(id: string | null) {
    this.hover = id ? this.layout.findIndex((b) => b.id === id) : -1;
  }

  /**
   * Feeds the right index fingertip (null if not tracked). Returns a button id
   * when the fingertip pushes through one. The finger has to come back out
   * before it can press again.
   */
  poke(tip: THREE.Vector3 | null): string | null {
    if (!this.visible || !tip) {
      this.tip.visible = false;
      this.armed = true;
      return null;
    }
    const local = this.mesh.worldToLocal(tip.clone());
    const inside = Math.abs(local.x) <= W / 2 && Math.abs(local.y) <= H / 2;
    const near = inside && local.z < 0.06 && local.z > -0.04;
    this.tip.visible = near;
    if (near) this.tip.position.copy(tip);
    const i = inside ? this.at(new THREE.Vector2(local.x / W + 0.5, local.y / H + 0.5)) : -1;
    if (near && i >= 0) this.hover = i;
    if (local.z > 0.02 || !inside) this.armed = true;
    if (this.armed && near && local.z < 0.006 && i >= 0) {
      this.armed = false;
      return this.layout[i].id;
    }
    return null;
  }

  /** Lights a button briefly, as feedback for a press. */
  pressed(id: string, now: number) {
    this.flash = this.layout.findIndex((b) => b.id === id);
    this.flashUntil = now + 180;
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
