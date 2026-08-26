export function screenAngleDeg() {
  if (typeof window.orientation === 'number') return window.orientation
  if (typeof screen.orientation?.angle === 'number') return screen.orientation.angle
  return window.innerWidth > window.innerHeight ? 90 : 0
}

export function screenRoll(gx, gy, sensitivity = 1) {
  const angleDeg = screenAngleDeg()
  const angle = (angleDeg * Math.PI) / 180
  let sx = gx * Math.cos(angle) + gy * Math.sin(angle)
  let sy = -gx * Math.sin(angle) + gy * Math.cos(angle)
  if (sy > 0) {
    sx = -sx
    sy = -sy
  }
  const roll = Math.atan2(sx, -sy)
  const range = ((35 * Math.PI) / 180) / Math.max(Number(sensitivity) || 1, 0.05)
  return {
    angleDeg,
    sx,
    sy,
    roll,
    rollDeg: (roll * 180) / Math.PI,
    steering: Math.max(-1, Math.min(1, roll / range)),
  }
}

export function gravityFromMotion(event) {
  const g = event.accelerationIncludingGravity
  if (!g || (g.x === 0 && g.y === 0 && g.z === 0)) return null
  return { gx: g.x, gy: g.y, gz: g.z }
}

export function gravityFromOrientation(event) {
  const beta = ((event.beta ?? 0) * Math.PI) / 180
  const gamma = ((event.gamma ?? 0) * Math.PI) / 180
  return {
    gx: Math.cos(beta) * Math.sin(gamma),
    gy: -Math.sin(beta),
  }
}

export function requestTiltPermission() {
  const pending = []
  const ask = (EventC) => {
    if (typeof EventC === 'undefined' || typeof EventC.requestPermission !== 'function') return
    pending.push(EventC.requestPermission())
  }
  ask(window.DeviceMotionEvent)
  ask(window.DeviceOrientationEvent)
  if (!pending.length) return Promise.resolve([])
  return Promise.all(pending)
}
