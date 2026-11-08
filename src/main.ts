import * as THREE from "three";
import { LIBRARY, VIDEOS, loadLocalLibrary, loadScan, thinScan, type ScanInfo } from "./scans";
import { Stage, type XrMode } from "./stage";
import { XrInput } from "./input";
import { AutoDetail } from "./autoDetail";

type LookName = "colour" | "hologram";
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
const state = { index: 0, look: "colour" as LookName, density: 1, loadToken: 0 };
const auto = new AutoDetail();
/** In a headset, scans bigger than this are replaced by a thinned copy when they load. */
const HEADSET_MAX_SPLATS = 150_000;

const input = new XrInput(stage, {
  prevScan: () => step(-1),
  nextScan: () => step(1),
  cycleLook: () => setLook(state.look === "colour" ? "hologram" : "colour"),
  toggleAuto: () => setAuto(!auto.enabled),
  toggleVideo: () => toggleVideo(),
  videoPanel: () => videoPanel(),
  reset: () => resetAll(),
  exit: () => stage.renderer.xr.getSession()?.end(),
  menu: () => {
    const space = stage.scan?.info.kind === "space";
    const pos = order().indexOf(state.index) + 1;
    return [
      { id: "prev", label: "‹ Prev" },
      { id: "next", label: "Next ›", sub: `${pos} of ${library.length}` },
      { id: "look", label: state.look === "colour" ? "Colour" : "Hologram", sub: "look" },
      { id: "auto", label: auto.enabled ? `Auto ${Math.round(state.density * 100)}%` : `${Math.round(state.density * 100)}%`, sub: auto.enabled ? "detail" : "Auto off", tone: auto.enabled ? "accent" : undefined },
      { id: "reset", label: space ? "Recentre" : "Put back" },
      { id: "video", label: stage.screen.visible ? "Hide video" : "Video" },
      { id: "exit", label: "Exit VR", wide: true, tone: "exit" },
    ];
  },
});
let lastCard = 0;
stage.onFrame = (frame, dt) => {
  if (stage.mode) input.update(frame, dt);
  const s = stage.scan;
  // Auto only adjusts in a headset: on a computer, frame rate is often limited by
  // other things (a background tab, a 30 Hz headless browser), not by splats.
  if (!s || !stage.mode) return;
  const now = performance.now();
  const target = stage.renderer.xr.getSession()?.frameRate ?? 72;
  const next = auto.frame(now, dt * 1000, target, state.density, s.splats);
  if (next !== null) setDensity(next, true);
  else if (auto.enabled && now - lastCard > 1000) updateCounts(); // keep the fps readout fresh
};

/* ── Scans ───────────────────────────────────────────────────────── */

async function open(index: number) {
  const token = ++state.loadToken;
  const info = library[index];
  status(`Loading ${info.title}…`);
  try {
    let scan = await loadScan(info);
    if (stage.mode && auto.enabled && scan.splats > HEADSET_MAX_SPLATS) {
      status(`Thinning ${info.title} for the headset…`);
      const full = scan;
      scan = await thinScan(full, HEADSET_MAX_SPLATS);
      full.mesh.dispose();
    }
    if (token !== state.loadToken) {
      scan.mesh.dispose(); // a newer choice won
      return;
    }
    state.index = index;
    input.releaseAll();
    stage.show(scan);
    // In a headset, start near the level it handled last time and let Auto settle.
    setDensity(autoStart(), true);
    stage.resetPlacement();
    setScale(1);
    renderLibrary();
    updateCounts();
    status("");
    remember();
  } catch (e) {
    status(e instanceof Error && e.message ? e.message : `${info.title} couldn't be opened as a splat file.`);
  }
}

/** Library indices in the order they're listed: objects, then spaces. */
function order() {
  const idx = library.map((_, i) => i);
  return [...idx.filter((i) => library[i].kind !== "space"), ...idx.filter((i) => library[i].kind === "space")];
}

/** The previous (−1) or next (+1) scan in the list. */
function step(dir: number) {
  const o = order();
  const at = Math.max(0, o.indexOf(state.index));
  open(o[(at + dir + o.length) % o.length]);
}

function renderLibrary() {
  const ul = $("#library");
  ul.innerHTML = "";
  const hasSpaces = library.some((s) => s.kind === "space");
  let group = "";
  order().forEach((i) => {
    const s = library[i];
    const g = s.kind === "space" ? "Spaces" : "Objects";
    if (hasSpaces && g !== group) {
      group = g;
      const h = document.createElement("li");
      h.className = "group";
      h.textContent = g;
      ul.append(h);
    }
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
  inputEl.value = "";
  if (f) openFile(f);
});

const SCAN_FILE = /\.(spz|ply|splat|ksplat)$/i;
async function openFile(f: File) {
  if (f.type.startsWith("video/")) return playVideo(URL.createObjectURL(f), f.name);
  if (!SCAN_FILE.test(f.name)) return status(`${f.name} isn't a scan (.spz, .ply, .splat, .ksplat) or a video.`);
  const bytes = new Uint8Array(await f.arrayBuffer());
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
}

// Drop a scan or a video anywhere on the page.
const app = $("#app");
app.addEventListener("dragover", (e) => {
  if (!e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault();
  app.classList.add("dropping");
});
app.addEventListener("dragleave", (e) => {
  if (e.target === app || !app.contains(e.relatedTarget as Node)) app.classList.remove("dropping");
});
app.addEventListener("drop", (e) => {
  e.preventDefault();
  app.classList.remove("dropping");
  const f = e.dataTransfer?.files[0];
  if (f) openFile(f);
});

/* ── Look ────────────────────────────────────────────────────────── */

const fromLog = (v: number) => Math.pow(10, -2 + (2 * v) / 1000); // 1% … 100%
const toLog = (d: number) => Math.round(((Math.log10(d) + 2) / 2) * 1000);

document.querySelectorAll<HTMLElement>("[data-look]").forEach((b) => b.addEventListener("click", () => setLook(b.dataset.look as LookName)));

function setLook(look: LookName) {
  state.look = look;
  document.querySelectorAll<HTMLElement>("[data-look]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.look === look)));
  stage.look.holo.value = look === "hologram" ? 1 : 0;
  stage.scan?.mesh.updateVersion(); // redraw the splats in the new look
  updateCounts();
  remember();
}

/** Auto picks the detail to hold the frame rate; off, the slider sets it. */
function setAuto(on: boolean) {
  auto.enabled = on;
  $<HTMLInputElement>("#auto").checked = on;
  if (on) setDensity(autoStart(), true);
  updateCounts();
  remember();
}

/** Where Auto starts: the remembered budget in a headset, everything on a computer. */
function autoStart() {
  if (!auto.enabled) return state.density;
  return stage.mode && stage.scan ? auto.start(stage.scan.splats, performance.now()) : 1;
}
$<HTMLInputElement>("#auto").addEventListener("change", (e) => setAuto((e.target as HTMLInputElement).checked));

const densityInput = $<HTMLInputElement>("#density");
densityInput.addEventListener("input", () => {
  // Choosing a level by hand turns Auto off.
  if (auto.enabled) setAuto(false);
  setDensity(fromLog(Number(densityInput.value)));
});
function setDensity(d: number, fromAuto = false) {
  state.density = d;
  stage.look.density.value = d;
  densityInput.value = String(toLog(d));
  const pctText = d >= 0.999 ? "100%" : `${(d * 100).toFixed(d < 0.1 ? 1 : 0)}%`;
  $("#density-out").textContent = fromAuto && auto.enabled ? (stage.mode ? `Auto · ${pctText}` : `Auto · ${pctText} (adjusts in a headset)`) : pctText;
  stage.scan?.mesh.updateVersion();
  updateCounts();
}

function updateCounts() {
  const s = stage.scan;
  if (!s) return;
  lastCard = performance.now();
  const drawn = Math.round(s.splats * state.density);
  const text = `${drawn.toLocaleString("en-US")} of ${s.splats.toLocaleString("en-US")} splats${s.thinnedFrom ? ` (thinned from ${s.thinnedFrom.toLocaleString("en-US")})` : ""}`;
  const fps = auto.enabled && stage.mode && auto.fps ? ` · ${Math.round(auto.fps)} fps` : "";
  $("#splat-count").textContent = text + fps;
  const detail = auto.enabled ? `Auto ${Math.round(state.density * 100)}%` : `${Math.round(state.density * 100)}%`;
  stage.drawCard(`${state.look === "colour" ? "Colour" : "Hologram"} · ${detail} · ${text}${fps}`);
}

/* ── Size ────────────────────────────────────────────────────────── */

// Scale slider is logarithmic: −200 … 300 → ¼× … 8×.
const scaleInput = $<HTMLInputElement>("#scale");
scaleInput.addEventListener("input", () => setScale(Math.pow(2, Number(scaleInput.value) / 100)));
function setScale(s: number) {
  s = THREE.MathUtils.clamp(s, 0.25, 8);
  stage.exhibit.scale.setScalar(s);
  document.querySelectorAll<HTMLElement>("[data-scale]").forEach((b) => b.setAttribute("aria-pressed", String(Math.abs(Number(b.dataset.scale) - s) < 0.01)));
  scaleInput.value = String(Math.round(Math.log2(s) * 100));
  $("#scale-out").textContent = Math.abs(s - 1) < 0.01 ? "1× (real size)" : `${s < 1 ? s.toFixed(2) : s.toFixed(1)}×`;
}
document.querySelectorAll<HTMLElement>("[data-scale]").forEach((b) => b.addEventListener("click", () => setScale(Number(b.dataset.scale))));

/** Back in front of you at real size (a space: back around you). */
function resetAll() {
  input.releaseAll();
  stage.resetPlacement();
  setScale(1);
}
$("#reset").addEventListener("click", resetAll);

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
  syncVideoButtons();
}

function toggleVideo() {
  const v = stage.video;
  if (!v.src) return;
  stage.screen.visible = true;
  if (v.paused) v.play().catch(() => {});
  else v.pause();
}

/** Shows the screen beside you (starting the first clip if nothing is loaded), or hides it. */
function videoPanel() {
  if (stage.screen.visible) {
    stage.screen.visible = false;
    stage.video.pause();
  } else {
    if (!stage.video.src) playVideo(VIDEOS[0].url, VIDEOS[0].title);
    else stage.video.play().catch(() => {});
    if (stage.mode) stage.placeScreenNearYou();
    stage.screen.visible = true;
  }
  syncVideoButtons();
}

function syncVideoButtons() {
  $("#hide-video").textContent = stage.screen.visible ? "Hide" : "Show";
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
  syncVideoButtons();
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
    // A big scan gets swapped for a thinned copy in the headset, and back afterwards.
    if (auto.enabled && stage.scan && stage.scan.splats > HEADSET_MAX_SPLATS) await open(state.index);
    else setDensity(autoStart(), true);
    stage.say("Turn your left palm toward you for the menu", 6000);
    stage.renderer.xr.getSession()?.addEventListener("end", () => {
      input.releaseAll();
      input.menu.place(null, new THREE.Vector3(), true); // hide the menu
      if (stage.scan?.thinnedFrom) open(state.index);
      else setDensity(autoStart(), true);
    });
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
  // In the headset the page can't be seen: show it there too (errors stay longer).
  if (stage.mode) stage.say(msg, msg.endsWith("…") ? 0 : 4000);
}

/* ── Keys (on a computer) ────────────────────────────────────────── */

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target as HTMLElement;
  if (t.closest("input, textarea, select, [contenteditable]")) return;
  const keys: Record<string, () => void> = {
    ArrowLeft: () => step(-1),
    ArrowRight: () => step(1),
    h: () => setLook(state.look === "colour" ? "hologram" : "colour"),
    a: () => setAuto(!auto.enabled),
    r: resetAll,
    v: () => (stage.video.src ? toggleVideo() : videoPanel()),
    " ": () => (stage.video.src ? toggleVideo() : videoPanel()),
    "0": () => setScale(1),
    "1": () => setScale(1),
    "=": () => setScale(stage.exhibit.scale.x * 1.25),
    "+": () => setScale(stage.exhibit.scale.x * 1.25),
    "-": () => setScale(stage.exhibit.scale.x / 1.25),
  };
  const fn = keys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!fn) return;
  // Space and the arrows would otherwise press a focused button or scroll the panel.
  e.preventDefault();
  fn();
});

/* ── Remembered between visits ───────────────────────────────────── */

const SAVED = "vitrine:v1";
const scanKey = (s: ScanInfo) => s.url ?? s.id;

function remember() {
  const s = stage.scan?.info;
  try {
    const prev = JSON.parse(localStorage.getItem(SAVED) ?? "{}");
    // Files opened from the device can't be reopened next time; keep the last library scan.
    const scan = s && !s.bytes ? scanKey(s) : prev.scan;
    localStorage.setItem(SAVED, JSON.stringify({ scan, look: state.look, auto: auto.enabled }));
  } catch {
    // Private browsing or storage off: nothing to remember.
  }
}

function recall(): { scan?: string; look?: LookName; auto?: boolean } {
  try {
    return JSON.parse(localStorage.getItem(SAVED) ?? "{}");
  } catch {
    return {};
  }
}

if (import.meta.env.DEV) Object.assign(window, { __vitrine: { stage, input, state, auto, open, step, setLook, setAuto, setDensity, setScale, playVideo, videoPanel, resetAll, library } });

const saved = recall();
renderLibrary();
renderVideos();
setLook(saved.look === "hologram" ? "hologram" : "colour");
setAuto(saved.auto ?? true);
checkXr();
// Your own scans (public/local) join the library first, so the last one you looked at can reopen.
loadLocalLibrary().then((extra) => {
  library.splice(LIBRARY.length, 0, ...extra);
  const i = library.findIndex((s) => scanKey(s) === saved.scan);
  open(i >= 0 ? i : 0);
});
