// Contact heat paint: verts in the penetration slab get heated, then fade back.
// Avoids noisy tracking of jittery Ammo contact points.

export const CONTACT_OVERLAY_NAME = '__contact_overlay'

const PAINT_SMOOTH = 0.18
const HEAT_FADE_PER_SEC = 2.8

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
  vehicle._smoothContactPoint = new THREE.Vector3()
  vehicle._smoothContactNormal = new THREE.Vector3(0, 0, -1)
  vehicle._smoothContactDepth = 0
  vehicle._contactSmoothReady = false
  vehicle._heatWorldPos = new THREE.Vector3()

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

function updateContactHeat(vehicle, contact, dt = 1 / 60) {
  ensureContactOverlays(vehicle)
  const fade = Math.exp(-HEAT_FADE_PER_SEC * dt)
  const paint = !!(contact && contact.depth > 1e-4)

  if (paint) {
    if (!vehicle._contactSmoothReady) {
      vehicle._smoothContactPoint.copy(contact.point)
      vehicle._smoothContactNormal.copy(contact.normal).normalize()
      vehicle._smoothContactDepth = contact.depth
      vehicle._contactSmoothReady = true
    } else {
      vehicle._smoothContactPoint.lerp(contact.point, PAINT_SMOOTH)
      vehicle._smoothContactNormal.lerp(contact.normal, PAINT_SMOOTH).normalize()
      vehicle._smoothContactDepth += (contact.depth - vehicle._smoothContactDepth) * PAINT_SMOOTH
    }
  }

  const C = vehicle._smoothContactPoint
  const N = vehicle._smoothContactNormal
  const D = Math.max(vehicle._smoothContactDepth, 0)
  const worldPos = vehicle._heatWorldPos
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
      if (paint && D > 1e-4) {
        worldPos.fromBufferAttribute(pos, i).applyMatrix4(mw)
        const s = (worldPos.x - C.x) * N.x + (worldPos.y - C.y) * N.y + (worldPos.z - C.z) * N.z
        if (s <= 0 && s >= -D) h = Math.max(h, 1)
      }
      arr[i] = h
      if (h > 0.02) anyHot = true
    }
    heat.needsUpdate = true
    overlay.visible = anyHot
  }

  if (!paint && !anyHot) vehicle._contactSmoothReady = false
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
  vehicle._contactSmoothReady = false
}

function disposeContactOverlays(vehicle) {
  if (!vehicle._contactOverlays) return
  for (const overlay of vehicle._contactOverlays) {
    overlay.parent?.remove(overlay)
  }
  vehicle._contactOverlays = null
  vehicle._contactMaterial = null
  vehicle._contactSmoothReady = false
}

export {
  makeContactOverlayMaterial,
  ensureContactOverlays,
  updateContactHeat,
  clearContactOverlay,
  disposeContactOverlays,
}
