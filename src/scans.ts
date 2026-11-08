import * as THREE from "three";
import { PackedSplats, SplatMesh } from "@sparkjsdev/spark";

export interface ScanInfo {
  id: string;
  title: string;
  /** Second line of the info card: who, when, how. */
  byline: string;
  licence: string;
  /** An object you hold, or a space you stand in (a whole room or world). */
  kind?: "object" | "space";
  /** Objects: real height in metres, if known; otherwise shown 30 cm tall. */
  height?: number;
  /** Spaces: metres per file unit (default 1). The file's origin is put at your eyes. */
  scale?: number;
  /** Splats from COLMAP/Brush are stored y-down. */
  yDown: boolean;
  /** Extra turn about the vertical, in degrees, for files whose "front" faces the other way. */
  yaw?: number;
  url?: string;
  bytes?: Uint8Array;
  fileName?: string;
}

/** Your Pharoscope captures, as listed on Lexindex. */
export const LIBRARY: ScanInfo[] = [
  {
    id: "LXS-000002",
    title: "Pink bottle with a hummingbird sticker",
    byline: "D. Voyles · Pharoscope sweep · 21 Oct 2026",
    licence: "CC BY 4.0",
    height: 0.26,
    yDown: true,
    url: "scans/water-bottle.spz",
  },
  {
    id: "LXS-000001",
    title: "Jar of whole psyllium husks, 340 g",
    byline: "D. Voyles · Pharoscope sweep · 14 Oct 2026",
    licence: "CC BY 4.0",
    height: 0.17,
    yDown: true,
    url: "scans/psyllium-jar.spz",
  },
];

export const VIDEOS = [
  { title: "Bottle, turning (Lexindex clip)", url: "videos/LXS-000002-turn.mp4" },
  { title: "Jar, turning (Lexindex clip)", url: "videos/LXS-000001-turn.mp4" },
];

/**
 * Optional extra scans for testing, listed in public/local/scans.json (git-ignored,
 * so files you don't own, or very big ones, never end up in the repo). Each entry
 * is a ScanInfo with `file` instead of `url`.
 */
export async function loadLocalLibrary(): Promise<ScanInfo[]> {
  try {
    const r = await fetch("local/scans.json");
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return [];
    const list = (await r.json()) as (Omit<ScanInfo, "url"> & { file: string })[];
    return list.map(({ file, ...s }) => ({ ...s, url: `local/${file}` }));
  } catch {
    return [];
  }
}

export interface LoadedScan {
  info: ScanInfo;
  mesh: SplatMesh;
  /** File → object space: upright, centred, base at 0, real size. */
  base: THREE.Matrix4;
  height: number;
  radius: number;
  splats: number;
  /** Set when this is a thinned copy for the headset: the original splat count. */
  thinnedFrom?: number;
  /** Up direction in the file's own coordinates, and the height range along it. */
  up: THREE.Vector3;
  hMin: number;
  hMax: number;
}

export async function loadScan(info: ScanInfo): Promise<LoadedScan> {
  const mesh = info.bytes ? new SplatMesh({ fileBytes: info.bytes, fileName: info.fileName }) : new SplatMesh({ url: info.url! });
  await mesh.initialized;

  const flip = info.yDown ? new THREE.Matrix4().makeRotationZ(Math.PI) : new THREE.Matrix4();
  if (info.yaw) flip.premultiply(new THREE.Matrix4().makeRotationY((info.yaw * Math.PI) / 180));
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const v = new THREE.Vector3();
  let n = 0;
  let nearOrigin = 0;
  mesh.forEachSplat((_i, c, _s, _q, a) => {
    n++;
    if (a < 0.2) return;
    if (c.lengthSq() < 1) nearOrigin++;
    v.copy(c).applyMatrix4(flip);
    xs.push(v.x);
    ys.push(v.y);
    zs.push(v.z);
  });
  if (xs.length < 10) throw new Error(`${info.title} has no visible splats.`);
  const pct = (arr: number[], p: number) => {
    const s = Float64Array.from(arr).sort();
    return s[Math.round(p * (s.length - 1))];
  };
  const [x0, x1, y0, y1, z0, z1] = [pct(xs, 0.01), pct(xs, 0.99), pct(ys, 0.01), pct(ys, 0.99), pct(zs, 0.01), pct(zs, 0.99)];
  const space = info.kind === "space";
  const scale = space ? (info.scale ?? 1) : (info.height ?? 0.3) / Math.max(1e-6, y1 - y0);
  const height = space ? (y1 - y0) * scale : (info.height ?? 0.3);
  // Objects: centred, base on the ground. Spaces: the file's origin (usually where
  // the world was generated or captured from) stays put, and goes at your eyes.
  const base = new THREE.Matrix4().makeScale(scale, scale, scale);
  if (!space) base.multiply(new THREE.Matrix4().makeTranslation(-(x0 + x1) / 2, -y0, -(z0 + z1) / 2));
  else if (nearOrigin < xs.length * 0.005) {
    // Nothing around the file's origin, so it isn't a viewpoint: start in the
    // middle of the content instead, standing on its lowest ground.
    base.multiply(new THREE.Matrix4().makeTranslation(-pct(xs, 0.5), -(y0 + 1.6 / scale), -pct(zs, 0.5)));
  }
  base.multiply(flip);
  const radius = Math.hypot(x1 - x0, y1 - y0, z1 - z0) * 0.5 * scale;
  // In file coordinates "up" is +y, or −y for y-down captures.
  const up = new THREE.Vector3(0, info.yDown ? -1 : 1, 0);
  return { info, mesh, base, height, radius, splats: n, up, hMin: y0, hMax: y1 };
}

/**
 * A copy of a scan with at most `max` splats. Hiding splats in the shader still
 * leaves Spark sorting all of them, so for very large scans the headset needs a
 * genuinely smaller copy.
 *
 * Splats are picked by a weighted random draw (Efraimidis–Spirakis keys) that
 * favours big, solid splats, the ones that carry the picture; the tiny faint ones
 * that make up most of a big capture go first. Kept splats grow a little to cover
 * the gaps. The draw is seeded by splat index, so the same scan always thins the
 * same way. Colour beyond each splat's base colour (view-dependent shading)
 * isn't kept.
 */
export async function thinScan(scan: LoadedScan, max: number): Promise<LoadedScan> {
  const keys = new Float32Array(scan.splats);
  scan.mesh.forEachSplat((i, _c, s, _q, a) => {
    const size = Math.cbrt(Math.max(1e-12, s.x * s.y * s.z));
    keys[i] = Math.log(hash01(i)) / Math.max(1e-9, a * size); // larger = keep
  });
  const cut = keys.slice().sort()[Math.max(0, scan.splats - max)];
  const grow = Math.min(2.2, Math.max(1, Math.cbrt(scan.splats / max) * 0.7));
  const packed = new PackedSplats({ maxSplats: max + 1000 });
  const scale = new THREE.Vector3();
  scan.mesh.forEachSplat((i, c, s, q, a, col) => {
    if (keys[i] >= cut && packed.numSplats < max) packed.pushSplat(c, scale.copy(s).multiplyScalar(grow), q, a, col);
  });
  const mesh = new SplatMesh({ packedSplats: packed });
  await mesh.initialized;
  return { ...scan, mesh, splats: packed.numSplats, thinnedFrom: scan.splats };
}

/** A fixed pseudo-random number in (0, 1) for splat `i` (PCG hash). */
function hash01(i: number) {
  let h = Math.imul(i, 747796405) + 2891336453;
  h = Math.imul((h >>> ((h >>> 28) + 4)) ^ h, 277803737);
  h = ((h >>> 22) ^ h) >>> 0;
  return (h + 0.5) / 4294967296;
}
