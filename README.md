# Vitrine

Pharoscope scans at real size in a Meta Quest: in passthrough, on your own desk, or
in VR. Pick one up, turn it in your hand, scale it with both hands, switch it to a
sparse or hologram look, and play Lexindex clips beside it. It also works on a
computer, with the mouse.

It's a web app (WebXR), so there's nothing to install on the headset: you open a page
in the Quest's browser.

## What it does

- **Real size.** The bottle is shown 26 cm tall and the jar 17 cm, on a small ring at
  desk height in front of you.
- **Passthrough or VR.** Passthrough puts the scan in your room; VR puts it on a dark
  floor grid.
- **Hands or controllers.** A grip, trigger or pinch picks it up. Holding it with both
  hands and pulling apart or together scales it.
- **Looks.** Full; Sparse (fewer splats, which is how big scans fit the Quest's GPU); or
  Hologram (one colour, see-through points, a scan line).
- **Info card** above the scan: title, who captured it, when, licence, look and splat count.
- **Video screen** beside it for Lexindex "Text it" clips. Two are bundled; open any
  other from the device (in the Quest browser, saved clips are in Downloads).

### In the headset

| Input | Does |
| --- | --- |
| Grip, trigger or pinch on the scan (near it, or pointing at it) | Pick it up; it moves and turns with your hand |
| Both hands holding it | Pull apart or together to scale |
| Trigger or pinch on the video | Play or pause |
| Right **A** / **B** | Next scan / next look |
| Right thumbstick | Turn it (left/right) and scale it (up/down) |
| Left **X** / **Y** | Put it back in front of you / show or hide the video |

## Try it on your Quest

WebXR only runs on secure pages (https or `localhost`). The simplest way during
development is a USB cable, which makes the Mac's dev server show up as `localhost` on
the headset:

1. Turn on **Developer Mode** for the Quest (Meta Horizon app on your phone → Devices →
   Headset settings → Developer Mode). You need a free Meta developer account for this.
2. Plug the Quest into the Mac with USB-C and allow USB debugging in the headset.
3. On the Mac:
   ```bash
   bun install
   bun run quest      # = adb reverse tcp:5173 tcp:5173 && vite --host
   ```
   `adb` comes with the Android SDK at `~/Library/Android/sdk/platform-tools/adb`; add
   that folder to your PATH if `adb` isn't found.
4. In the Quest's browser, open **http://localhost:5173** and tap **Enter passthrough**
   or **Enter VR**.

Once the site is hosted somewhere with https (GitHub Pages, Vercel, Netlify…), you can
skip all of that and just open its address in the Quest browser.

## Developing without a headset

`http://localhost:5173/?emulate=1` installs Meta's WebXR emulator ([IWER](https://github.com/meta-quest/immersive-web-emulation-runtime),
dev builds only), which pretends to be a Quest 3 with Touch controllers and hand tracking.
Everything in the table above was tested that way in Chrome: entering passthrough,
grabbing with a grip, two-hand scaling, the A/B/X buttons and pinch-grabbing. On a real
**Quest Pro** (Adreno 650) in passthrough it held a steady 72 fps for both scans in every
look (Full, Sparse and Hologram). Sparse becomes useful for scans of a million splats or
more. Grabbing has only been tested in the emulator so far.

## Code

| File | Does |
| --- | --- |
| `src/stage.ts` | three.js + [Spark](https://sparkjs.dev) scene, the exhibit, card, video screen, entering VR or passthrough |
| `src/input.ts` | Grabbing, two-hand scaling, controller buttons, rays |
| `src/look.ts` | Sparse and hologram, as a per-splat GPU modifier |
| `src/scans.ts` | The scan library, loading and real-size framing |
| `src/main.ts` | The page |

Built with Spark 2.4 and three.js 0.180. Scans and clips: D. Voyles, CC BY 4.0.
