# Vitrine

Pharoscope scans at real size in a Meta Quest: in passthrough, on your own desk, or
in VR. Pick one up, turn it in your hand, scale it with both hands, switch it to a
hologram look, and play Lexindex clips beside it. Whole rooms and outdoor scenes
open around you. It also works on a
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
- **Spaces.** A scan marked as a space (a room, a street) opens around you at eye level
  instead of on the ring.
- **Looks.** Colour, or Hologram (one colour, see-through points, a scan line).
- **Auto detail.** In the headset, Vitrine draws as many splats as keep it at the
  headset's full frame rate (72 fps on a Quest Pro) and adjusts as you move. Scans over
  150,000 splats are first thinned to 150,000, keeping the big, solid splats that carry
  the picture. Turn Auto off to set the share of splats by hand.
- **Info card** above the scan: title, who captured it, when, licence, look and splat count.
- **Video screen** beside it for Lexindex "Text it" clips. Two are bundled; open any
  other from the device (in the Quest browser, saved clips are in Downloads).

### In the headset

| Input | Does |
| --- | --- |
| Grip, trigger or pinch on the scan (near it, or pointing at it) | Pick it up; it moves and turns with your hand |
| Both hands holding it | Pull apart or together to scale |
| Trigger or pinch on the video | Play or pause |
| Right **A** / **B** | Next scan / colour or hologram |
| Right thumbstick | Turn it (left/right) and scale it (up/down) |
| Click the right thumbstick | Auto detail on or off |
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
look. Grabbing has only been tested in the emulator so far.

### How many splats the Quest Pro can draw

Measured in VR at 72 fps target:

| Scan | Splats | Without Auto | With Auto |
| --- | --- | --- | --- |
| Wolf (AWS sample) | 84k | 71 fps | 71.8 fps, all 84k drawn |
| Woobles | 578k | 7.7 fps | 71.6 fps, 80k drawn (thinned to 150k) |
| Snow street | 982k | 6.5 fps | 71.8 fps, 18k drawn (thinned to 150k) |
| Grey room | 2M | 4.3 fps | 71.8 fps, 50k drawn (thinned to 150k) |

Roughly 85–90k splats of an object hold 72 fps. Big outdoor scenes cost more per splat
because their splats cover more of the screen.

## Your own scans

Put scan files (`.spz`, `.ply`, `.splat`, `.ksplat`) in `public/local/` (git-ignored) with
a `scans.json` listing them:

```json
[{ "file": "jar.spz", "id": "jar", "title": "Jar on the desk", "byline": "Pharoscope, 7 Nov 2026",
   "licence": "CC BY 4.0", "yDown": true, "yaw": 180, "height": 0.4 }]
```

`yDown` is for captures stored upside down (most COLMAP and Brush output), `yaw` turns it
in degrees, `height` sets an object's real height in metres, and `"kind": "space"` opens it
around you (`scale` sets metres per file unit for a space). They appear in the library after the bundled scans.

## Code

| File | Does |
| --- | --- |
| `src/stage.ts` | three.js + [Spark](https://sparkjs.dev) scene, the exhibit, card, video screen, entering VR or passthrough |
| `src/input.ts` | Grabbing, two-hand scaling, controller buttons, rays |
| `src/look.ts` | Detail and hologram, as a per-splat GPU modifier |
| `src/autoDetail.ts` | Auto detail: holds the headset's frame rate by changing the share of splats drawn |
| `src/scans.ts` | The scan library, local scans, loading, real-size framing and thinning |
| `src/main.ts` | The page |

Built with Spark 2.4 and three.js 0.180. Scans and clips: D. Voyles, CC BY 4.0.
