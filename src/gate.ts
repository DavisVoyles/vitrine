/**
 * A shared password in front of the published site, to keep strangers and bots
 * out. GitHub Pages has no server to check it, so this happens in the page: the
 * app (and every scan and clip it loads) only starts once the password matches.
 * It isn't security: the code and bundled scans are in a public repo. Only a
 * hash of the password is kept here. A device that got in once is remembered.
 *
 * Dev builds skip it.
 */
import "./style.css";

const HASH = "b28c30da35c3fbef84806a9c21dca5dc8a24be1f04d974b1d93a99cfd5649b5f"; // sha-256 of the password
const KEY = "vitrine:unlocked";

const gate = document.getElementById("gate") as HTMLFormElement;
const app = document.getElementById("app")!;

function start() {
  gate.hidden = true;
  app.hidden = false;
  import("./main");
}

async function sha256(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function remembered() {
  try {
    return localStorage.getItem(KEY) === HASH;
  } catch {
    return false;
  }
}

if (import.meta.env.DEV || remembered()) start();
else {
  gate.hidden = false;
  const field = gate.querySelector("input")!;
  const note = gate.querySelector<HTMLElement>(".gate-note")!;
  field.focus();
  gate.addEventListener("submit", async (e) => {
    e.preventDefault();
    if ((await sha256(field.value.trim().toLowerCase())) !== HASH) {
      note.textContent = "That's not it. Ask whoever sent you the link.";
      field.select();
      return;
    }
    try {
      localStorage.setItem(KEY, HASH);
    } catch {
      // Private browsing: it will ask again next time.
    }
    note.textContent = "";
    start();
  });
}
