// One-shot heat wave along an axis (front car → rear car). Paints verts under the
// traveling band, then fades — no Ammo contact points.

export const CONTACT_OVERLAY_NAME = '__contact_overlay'

const HEAT_FADE_PER_SEC = 2.4
const WAVE_SPEED = 7.5
const WAVE_WIDTH = 0.55
const WAVE_TRAVEL = 5.5

function makeContactOverlayMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(1.0, 0.08, 0.1) },
    },
    vertexShader: `
      attribute float contactHeat;
      varying float vHeat;
      void main() {
        vHeat = contactHeat;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      varying float vHeat;
      void main() {
        if (vHeat < 0.02) discard;
        float a = smoothstep(0.02, 1.0, vHeat) * 0.75;
        gl_FragColor = vec4(color, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.FrontSide,
  })
}

function ensureHeatAttribute(geometry) {
  let heat = geometry.getAttribute('contactHeat')
  if (heat) return heat
  const n = geometry.attributes.position.count
  heat = new THREE.BufferAttribute(new Float32Array(n), 1)
  geometry.setAttribute('contactHeat', heat)
  return heat
}

function ensureContactOverlays(vehicle) {
  if (vehicle._contactOverlays?.length) return
  vehicle._contactMaterial = makeContactOverlayMaterial()
  vehicle._contactOverlays = []
  vehicle._heatWorldPos = new THREE.Vector3()
  vehicle._heatWave = null

  const roots = [vehicle.visualRoot, ...(vehicle.wheelMeshes ?? [])]
  for (const root of roots) {
    root.traverse(mesh => {
      if (!mesh.isMesh || mesh.userData.isCollisionMesh) return
      if (mesh.name?.startsWith('__')) return
      ensureHeatAttribute(mesh.geometry)
      const overlay = new THREE.Mesh(mesh.geometry, vehicle._contactMaterial)
      overlay.name = CONTACT_OVERLAY_NAME
      overlay.renderOrder = 1000
      overlay.visible = false
      mesh.add(overlay)
      vehicle._contactOverlays.push(overlay)
    })
  }
}

function hasActiveHeatWave(vehicle) {
  return !!vehicle._heatWave?.active
}

// origin: world start (near front car / nose). direction: front → rear (into the rear car).
function triggerHeatWave(vehicle, origin, direction, {
  speed = WAVE_SPEED,
  width = WAVE_WIDTH,
  travel = WAVE_TRAVEL,
} = {}) {
  ensureContactOverlays(vehicle)
  const dir = direction.clone()
  dir.y = 0
  if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1)
  else dir.normalize()

  vehicle._heatWave = {
    origin: origin.clone(),
    dir,
    t: -width,
    speed,
    width,
    maxT: travel,
    active: true,
  }
}

function updateContactHeat(vehicle, dt = 1 / 60) {
  ensureContactOverlays(vehicle)
  const fade = Math.exp(-HEAT_FADE_PER_SEC * dt)
  const wave = vehicle._heatWave
  if (wave?.active) {
    wave.t += wave.speed * dt
    if (wave.t > wave.maxT) wave.active = false
  }

  const worldPos = vehicle._heatWorldPos
  const painting = !!(wave?.active)
  const O = wave?.origin
  const D = wave?.dir
  const crest = wave?.t ?? 0
  const halfW = wave?.width ?? 0
  let anyHot = false

  for (const overlay of vehicle._contactOverlays) {
    const parent = overlay.parent
    if (!parent?.isMesh) continue
    parent.updateWorldMatrix(true, false)
    const mw = parent.matrixWorld
    const pos = overlay.geometry.attributes.position
    const heat = ensureHeatAttribute(overlay.geometry)
    const arr = heat.array

    for (let i = 0; i < pos.count; i++) {
      let h = arr[i] * fade
      if (painting) {
        worldPos.fromBufferAttribute(pos, i).applyMatrix4(mw)
        const along =
          (worldPos.x - O.x) * D.x +
          (worldPos.y - O.y) * D.y +
          (worldPos.z - O.z) * D.z
        const dist = Math.abs(along - crest)
        if (dist < halfW) {
          const falloff = 1 - dist / halfW
          h = Math.max(h, falloff * falloff)
        }
      }
      arr[i] = h
      if (h > 0.02) anyHot = true
    }
    heat.needsUpdate = true
    overlay.visible = anyHot
  }

  if (!painting && !anyHot) vehicle._heatWave = null
}

function clearContactOverlay(vehicle) {
  if (!vehicle._contactOverlays) return
  for (const overlay of vehicle._contactOverlays) {
    const heat = overlay.geometry?.getAttribute('contactHeat')
    if (heat) {
      heat.array.fill(0)
      heat.needsUpdate = true
    }
    overlay.visible = false
  }
  vehicle._heatWave = null
}

function disposeContactOverlays(vehicle) {
  if (!vehicle._contactOverlays) return
  for (const overlay of vehicle._contactOverlays) {
    overlay.parent?.remove(overlay)
  }
  vehicle._contactOverlays = null
  vehicle._contactMaterial = null
  vehicle._heatWave = null
}

export {
  makeContactOverlayMaterial,
  ensureContactOverlays,
  triggerHeatWave,
  hasActiveHeatWave,
  updateContactHeat,
  clearContactOverlay,
  disposeContactOverlays,
}
