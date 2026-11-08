# Vitrine

Guide for coding agents. `README.md` covers what it does and how to run it on a headset.

## What this is

A WebXR app that shows 3D Gaussian scans at real size in a Meta Quest, in passthrough or VR. You can pick them up, scale them, walk through rooms, switch to a hologram look, and play short clips beside them. It also works on a computer with a mouse. TypeScript, Vite, Spark 2.4 and three.js 0.180. No server.

It's part of a wider set of projects by the same owner: an Android capture app (Pharoscope), a desktop processing app, and the Lexindex site.

**This repo is public.** Keep private details out of it: no passwords, account details or notes about private projects.

## Layout

| File in `src/` | What's there |
| --- | --- |
| `gate.ts` | Entry point. A shared password in front of the published site, then it loads `main.ts` |
| `main.ts` | The page: scan library, look, detail, video, keyboard, drag and drop, entering a headset |
| `stage.ts` | three.js + Spark scene, exhibit, info card, video screen, in-headset messages |
| `input.ts` | Grabbing, two-hand scaling, moving through spaces, controller buttons, rays |
| `wristMenu.ts` | The menu over the left palm: placement, poking and pointing |
| `autoDetail.ts` | Holds the headset's frame rate by changing the share of splats drawn |
| `scans.ts` | Scan library, local scans, loading, real-size framing, `thinScan` |
| `look.ts` | Density and hologram, as a per-splat GPU modifier |

## Commands

```bash
bun install
bun run dev         # http://localhost:5173, also on the network
bun run typecheck
bun run build
bun run quest       # adb reverse + dev server, for a USB-connected Quest
```

There are no automated tests. Add `?emulate=1` in dev to get Meta's IWER headset emulator (controllers and hands), which headless Chrome can drive. Dev builds skip the password gate and expose `window.__vitrine`.

Testing on a real Quest over USB: `adb reverse tcp:5173 tcp:5173`, open the page in the Quest browser, and use `adb forward tcp:9223 localabstract:chrome_devtools_remote` to reach its DevTools. Entering VR needs a person to tap the button.

## Rules and gotchas

- **Publishing:** every push to `main` builds in CI and deploys to GitHub Pages (`.github/workflows/pages.yml`).
- **Never commit `public/local/`.** It holds test scans, some belonging to other people. It's git-ignored; a local `vite build` would still copy it into `dist/`, which is why deploys are built in CI.
- **Never write the site password in the repo.** Only its hash is in `gate.ts`.
- **Everything in the headset must work with hands alone.** The owner uses hand tracking, so controller buttons can only be shortcuts.
- `enterXr` waits two session frames before placing the exhibit, because the head pose isn't known sooner.
- After a look change, call `mesh.updateVersion()`, or the splats won't redraw.
- `session.updateTargetFrameRate(90)` never resolved in passthrough on a Quest Pro. Leave it at 72.
- **Quest Pro budget:** about 85–90k splats of an object hold 72 fps. Hiding splats doesn't help enough for very large scans, since Spark still sorts them all, so scans over 150,000 splats are really thinned on load in a headset (`thinScan`).

## Current state (2026-11-08)

Live on GitHub Pages. Verified on a Quest Pro with hands: wrist menu (point and pinch), Next, Look, Auto, Exit VR, and Auto holding about 72 fps. Not yet exercised on a real headset: poking the menu with a fingertip, the video button, and moving through a space.
