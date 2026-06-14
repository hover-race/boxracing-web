# AGENTS.md

## Dev server

`./run.sh` runs `http-server -c-1` (caching disabled — required so ES module edits
to `js/*.js` actually reload; plain `http-server` caches for an hour).

## CDP / browser debugging

- Drive the sim from a URL, not by clicking. The harness in `mainScene.js` reads
  `params` (see `gui.js`) and applies physics each frame when `params.runPhysics`.
- The rear-left wheel (`wheelIndex === 2`) pushes a ring buffer to `window.__wheelLog`
  every frame in `wheel.js`'s `update()` (drive torque, omega, slip, forward force,
  `fwdDotNose`/`velDotNose` for direction sanity). Read it via `Runtime.evaluate`.

## URL params

Any key in `params` can be overridden via query string; the URL beats localStorage.
Types are coerced from each param's default (booleans accept `true`/`1`).

```
http://localhost:8080/?throttleInput=1&engineTorque=900&autoStopPhysicsAfterSec=3
```

Implemented by `applyUrlParamOverrides()` in `gui.js`.

## Autostop

`params.autoStopPhysicsAfterSec` (GUI, default 0 = disabled). When > 0, physics stops
that many seconds after load (`setupDebugStepper` in `mainScene.js`) — handy for
one-shot capture runs.
