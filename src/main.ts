import "./style.css";
import * as THREE from "three";
import { LIBRARY, VIDEOS, loadScan, type ScanInfo } from "./scans";
import { Stage, type XrMode } from "./stage";
import { XrInput } from "./input";

type LookName = "full" | "sparse" | "hologram";
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;

// Dev only: ?emulate=1 installs Meta's WebXR emulator (a virtual Quest 3), so
// the headset code can be tested without one.
if (import.meta.env.DEV && new URLSearchParams(location.search).has("emulate")) {
  const { XRDevice, metaQuest3 } = await import("iwer");
  const device = new XRDevice(metaQuest3);
  device.installRuntime({ forceInstall: true });
  Object.assign(window, { __xrDevice: device });
}

const stage = new Stage($("#stage"));
const library: ScanInfo[] = [...LIBRARY];
const state = { index: 0, look: "full" as LookName, density: 1, loadToken: 0 };

const input = new XrInput(stage, {
  nextScan: () => open((state.index + 1) % library.length),
  cycleLook: () => setLook(state.look === "full" ? "sparse" : state.look === "sparse" ? "hologram" : "full"),
  toggleVideo: () => toggleVideo(),
  reset: () => stage.resetPlacement(),
});
stage.onFrame = (frame, dt) => {
  if (stage.mode) input.update(frame, dt);
};

/* ── Scans ───────────────────────────────────────────────────────── */

async function open(index: number) {
  const token = ++state.loadToken;
  const info = library[index];
  status(`Loading ${info.title}…`);
  try {
    const scan = await loadScan(info);
    if (token !== state.loadToken) {
      scan.mesh.dispose(); // a newer choice won
      return;
    }
    state.index = index;
    input.releaseAll();
    stage.show(scan);
    stage.resetPlacement();
    setScale(1);
    renderLibrary();
    updateCounts();
    status("");
  } catch (e) {
    status(e instanceof Error && e.message ? e.message : `${info.title} couldn't be opened as a splat file.`);
  }
}

function renderLibrary() {
  const ul = $("#library");
  ul.innerHTML = "";
  library.forEach((s, i) => {
    const b = document.createElement("button");
    b.className = "item" + (i === state.index && stage.scan?.info === s ? " on" : "");
    b.innerHTML = `<span class="t"></span><span class="m"></span>`;
    b.querySelector(".t")!.textContent = s.title;
    b.querySelector(".m")!.textContent = `${s.id} · ${s.licence}`;
    b.addEventListener("click", () => open(i));
    const li = document.createElement("li");
    li.append(b);
    ul.append(li);
  });
}

$<HTMLInputElement>("#scan-file").addEventListener("change", async (e) => {
  const inputEl = e.target as HTMLInputElement;
  const f = inputEl.files?.[0];
  if (!f) return;
  const bytes = new Uint8Array(await f.arrayBuffer());
  inputEl.value = "";
  library.push({
    id: "File",
    title: f.name.replace(/\.(spz|ply|splat|ksplat)$/i, ""),
    byline: "Opened from this device · size unknown, shown 30 cm tall",
    licence: "your file",
    yDown: true,
    bytes,
    fileName: f.name,
  });
  open(library.length - 1);
});

/* ── Look ────────────────────────────────────────────────────────── */

const fromLog = (v: number) => Math.pow(10, -2 + (2 * v) / 1000); // 1% … 100%
const toLog = (d: number) => Math.round(((Math.log10(d) + 2) / 2) * 1000);

document.querySelectorAll<HTMLElement>("[data-look]").forEach((b) => b.addEventListener("click", () => setLook(b.dataset.look as LookName)));

function setLook(look: LookName) {
  const first = look !== "full" && state.look === "full";
  state.look = look;
  document.querySelectorAll<HTMLElement>("[data-look]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.look === look)));
  stage.look.holo.value = look === "hologram" ? 1 : 0;
  // Sparse and hologram start at a level that suits a Quest; full is everything.
  if (look === "full") setDensity(1);
  else if (first) setDensity(look === "hologram" ? 0.15 : 0.25);
  $("#density-row").classList.toggle("is-off", look === "full");
  updateCounts();
}

const densityInput = $<HTMLInputElement>("#density");
densityInput.addEventListener("input", () => setDensity(fromLog(Number(densityInput.value))));
function setDensity(d: number) {
  state.density = d;
  stage.look.density.value = d;
  densityInput.value = String(toLog(d));
  $("#density-out").textContent = d >= 0.999 ? "100%" : `${(d * 100).toFixed(d < 0.1 ? 1 : 0)}%`;
  stage.scan?.mesh.updateVersion();
  updateCounts();
}

function updateCounts() {
  const s = stage.scan;
  if (!s) return;
  const drawn = Math.round(s.splats * state.density);
  const text = `${drawn.toLocaleString("en-US")} of ${s.splats.toLocaleString("en-US")} splats`;
  $("#splat-count").textContent = text;
  const lookName = state.look === "full" ? "Full" : state.look === "sparse" ? "Sparse" : "Hologram";
  stage.drawCard(`${lookName} · ${text}`);
}

/* ── Size ────────────────────────────────────────────────────────── */

// Scale slider is logarithmic: −200 … 300 → ¼× … 8×.
const scaleInput = $<HTMLInputElement>("#scale");
scaleInput.addEventListener("input", () => setScale(Math.pow(2, Number(scaleInput.value) / 100)));
function setScale(s: number) {
  stage.exhibit.scale.setScalar(s);
  scaleInput.value = String(Math.round(Math.log2(s) * 100));
  $("#scale-out").textContent = Math.abs(s - 1) < 0.01 ? "1× (real size)" : `${s < 1 ? s.toFixed(2) : s.toFixed(1)}×`;
}
$("#reset").addEventListener("click", () => {
  stage.resetPlacement();
  setScale(1);
});

/* ── Video ───────────────────────────────────────────────────────── */

function playVideo(src: string, title: string) {
  const v = stage.video;
  v.src = src;
  v.play().catch(() => {});
  stage.screen.visible = true;
  $<HTMLButtonElement>("#play").disabled = false;
  $<HTMLButtonElement>("#hide-video").disabled = false;
  status(`Playing ${title}`);
  setTimeout(() => status(""), 1500);
  renderVideos(src);
}

function toggleVideo() {
  const v = stage.video;
  if (!v.src) return;
  stage.screen.visible = true;
  if (v.paused) v.play().catch(() => {});
  else v.pause();
}

function renderVideos(current = "") {
  const ul = $("#videos");
  ul.innerHTML = "";
  for (const vid of VIDEOS) {
    const b = document.createElement("button");
    b.className = "item" + (current.endsWith(vid.url) ? " on" : "");
    b.textContent = vid.title;
    b.addEventListener("click", () => playVideo(vid.url, vid.title));
    const li = document.createElement("li");
    li.append(b);
    ul.append(li);
  }
}

stage.video.addEventListener("play", () => ($("#play").textContent = "Pause"));
stage.video.addEventListener("pause", () => ($("#play").textContent = "Play"));
$("#play").addEventListener("click", toggleVideo);
$("#hide-video").addEventListener("click", () => {
  stage.screen.visible = !stage.screen.visible;
  $("#hide-video").textContent = stage.screen.visible ? "Hide" : "Show";
});
$<HTMLInputElement>("#video-file").addEventListener("change", (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) playVideo(URL.createObjectURL(f), f.name);
});

// On a computer, clicking the screen plays or pauses it.
const ray = new THREE.Raycaster();
stage.renderer.domElement.addEventListener("click", (e) => {
  if (!stage.screen.visible || stage.mode) return;
  const r = stage.renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), stage.camera);
  if (ray.intersectObject(stage.screen).length) toggleVideo();
});

/* ── Headset ─────────────────────────────────────────────────────── */

async function checkXr() {
  const xr = navigator.xr;
  const [ar, vr] = xr
    ? await Promise.all([xr.isSessionSupported("immersive-ar").catch(() => false), xr.isSessionSupported("immersive-vr").catch(() => false)])
    : [false, false];
  $<HTMLButtonElement>("#enter-ar").disabled = !ar;
  $<HTMLButtonElement>("#enter-vr").disabled = !vr;
  $("#xr-note").textContent =
    ar || vr
      ? "Ready. Put the headset on after you tap a button."
      : window.isSecureContext
        ? "No headset found. Open this page in the Quest's browser to view in VR or passthrough."
        : "VR needs a secure page: open it through https or as localhost (see the README).";
}

async function enter(mode: XrMode) {
  try {
    await stage.enterXr(mode);
    stage.resetPlacement();
  } catch (e) {
    status(`Couldn't start ${mode === "immersive-ar" ? "passthrough" : "VR"}: ${(e as Error).message}`);
  }
}
$("#enter-ar").addEventListener("click", () => enter("immersive-ar"));
$("#enter-vr").addEventListener("click", () => enter("immersive-vr"));

/* ── Helpers ─────────────────────────────────────────────────────── */

function status(msg: string) {
  const s = $("#status");
  s.textContent = msg;
  s.classList.toggle("on", !!msg);
}

if (import.meta.env.DEV) Object.assign(window, { __vitrine: { stage, input, state, open, setLook, setDensity, setScale, playVideo, library } });

renderLibrary();
renderVideos();
setLook("full");
checkXr();
open(0);
