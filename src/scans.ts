import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";

export interface ScanInfo {
  id: string;
  title: string;
  /** Second line of the info card: who, when, how. */
  byline: string;
  licence: string;
  /** Real height in metres, if known; otherwise the scan is shown 30 cm tall. */
  height?: number;
  /** Splats from COLMAP/Brush are stored y-down. */
  yDown: boolean;
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

export interface LoadedScan {
  info: ScanInfo;
  mesh: SplatMesh;
  /** File → object space: upright, centred, base at 0, real size. */
  base: THREE.Matrix4;
  height: number;
  radius: number;
  splats: number;
  /** Up direction in the file's own coordinates, and the height range along it. */
  up: THREE.Vector3;
  hMin: number;
  hMax: number;
}

export async function loadScan(info: ScanInfo): Promise<LoadedScan> {
  const mesh = info.bytes ? new SplatMesh({ fileBytes: info.bytes, fileName: info.fileName }) : new SplatMesh({ url: info.url! });
  await mesh.initialized;

  const flip = info.yDown ? new THREE.Matrix4().makeRotationZ(Math.PI) : new THREE.Matrix4();
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const v = new THREE.Vector3();
  let n = 0;
  mesh.forEachSplat((_i, c, _s, _q, a) => {
    n++;
    if (a < 0.2) return;
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
  const height = info.height ?? 0.3;
  const scale = height / Math.max(1e-6, y1 - y0);
  const base = new THREE.Matrix4()
    .makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeTranslation(-(x0 + x1) / 2, -y0, -(z0 + z1) / 2))
    .multiply(flip);
  const radius = Math.hypot(x1 - x0, y1 - y0, z1 - z0) * 0.5 * scale;
  // In file coordinates "up" is +y, or −y for y-down captures.
  const up = new THREE.Vector3(0, info.yDown ? -1 : 1, 0);
  return { info, mesh, base, height, radius, splats: n, up, hMin: y0, hMax: y1 };
}
