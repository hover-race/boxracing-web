import { updateContactHeat, clearContactOverlay } from './contactOverlay.js'

export const GROUP_TRACK = 1
export const GROUP_CAR = 2
export const GROUP_CAR_SENSOR = 4

const CF_NO_CONTACT_RESPONSE = 4

let nextGhostUserIndex = 1
const vehiclesByGhostUserIndex = new Map()
let ghostPairCallbackInstalled = false

function ensureGhostPairCallback(physicsWorld) {
  if (ghostPairCallbackInstalled) return
  const callback = new Ammo.btGhostPairCallback()
  physicsWorld.getPairCache().setInternalGhostPairCallback(callback)
  ghostPairCallbackInstalled = true
}

function createConvexHullShape(geometry) {
  const shape = new Ammo.btConvexHullShape()
  const pos = geometry.attributes.position
  const v = new Ammo.btVector3()
  for (let i = 0; i < pos.count; i++) {
    v.setValue(pos.getX(i), pos.getY(i), pos.getZ(i))
    shape.addPoint(v, true)
  }
  Ammo.destroy(v)
  shape.recalcLocalAabb()
  return shape
}

function attachCarGhost(vehicle) {
  ensureGhostPairCallback(vehicle.physics.physicsWorld)

  const geometry = vehicle.collisionMesh.geometry
  const shape = createConvexHullShape(geometry)
  const ghost = new Ammo.btPairCachingGhostObject()
  ghost.setCollisionShape(shape)
  ghost.setCollisionFlags(CF_NO_CONTACT_RESPONSE)

  const userIndex = nextGhostUserIndex++
  ghost.setUserIndex(userIndex)
  vehiclesByGhostUserIndex.set(userIndex, vehicle)

  vehicle.physics.physicsWorld.addCollisionObject(ghost, GROUP_CAR_SENSOR, GROUP_CAR_SENSOR)
  vehicle.carGhost = ghost
  vehicle.carGhostShape = shape
  vehicle.carGhostUserIndex = userIndex
  syncCarGhost(vehicle)
}

function syncCarGhost(vehicle) {
  if (!vehicle.carGhost) return
  vehicle.carGhost.setWorldTransform(vehicle.collisionMesh.body.ammo.getWorldTransform())
}

function horizontalForward(vehicle, out) {
  out.set(0, 0, 1).applyQuaternion(vehicle.visualRoot.quaternion)
  out.y = 0
  if (out.lengthSq() < 1e-8) out.set(0, 0, 1)
  else out.normalize()
  return out
}

function pairKey(indexA, indexB) {
  return indexA < indexB ? `${indexA}:${indexB}` : `${indexB}:${indexA}`
}

// Deepest contact per car-ghost pair (depth, point, normalOnB). Normal on B points toward A.
function collectPairContacts(physicsWorld, out) {
  out.clear()
  const dispatcher = physicsWorld.getDispatcher()
  const manifoldCount = dispatcher.getNumManifolds()
  for (let i = 0; i < manifoldCount; i++) {
    const manifold = dispatcher.getManifoldByIndexInternal(i)
    const body0 = Ammo.castObject(manifold.getBody0(), Ammo.btCollisionObject)
    const body1 = Ammo.castObject(manifold.getBody1(), Ammo.btCollisionObject)
    const indexA = body0.getUserIndex()
    const indexB = body1.getUserIndex()
    if (!vehiclesByGhostUserIndex.has(indexA) || !vehiclesByGhostUserIndex.has(indexB)) continue

    let bestDepth = 0
    let bestPt = null
    let bestN = null
    const contactCount = manifold.getNumContacts()
    for (let j = 0; j < contactCount; j++) {
      const pt = manifold.getContactPoint(j)
      const depth = -pt.getDistance()
      if (depth <= bestDepth) continue
      bestDepth = depth
      const p = pt.get_m_positionWorldOnB()
      const n = pt.get_m_normalWorldOnB()
      bestPt = { x: p.x(), y: p.y(), z: p.z() }
      bestN = { x: n.x(), y: n.y(), z: n.z() }
    }
    if (bestDepth > 0 && bestPt) {
      out.set(pairKey(indexA, indexB), {
        depth: bestDepth,
        point: bestPt,
        normalOnB: bestN,
        indexA,
        indexB,
      })
    }
  }
}

function speedDiffRatio(a, b) {
  const va = Math.abs(a.getSpeed())
  const vb = Math.abs(b.getSpeed())
  return Math.abs(va - vb) / Math.max(va, vb, 1)
}

function rearAndFront(a, b, fwdA, fwdB) {
  const avgX = fwdA.x + fwdB.x
  const avgZ = fwdA.z + fwdB.z
  const len = Math.hypot(avgX, avgZ) || 1
  const dx = b.collisionMesh.position.x - a.collisionMesh.position.x
  const dz = b.collisionMesh.position.z - a.collisionMesh.position.z
  // Positive: B is ahead of A along travel → A is rear.
  if ((dx * avgX + dz * avgZ) / len > 0) return { rear: a, front: b }
  return { rear: b, front: a }
}

function softPushRear(rear, front, contact) {
  const depth = contact?.depth ?? 0
  const dx = rear.collisionMesh.position.x - front.collisionMesh.position.x
  const dz = rear.collisionMesh.position.z - front.collisionMesh.position.z
  const len = Math.hypot(dx, dz)
  if (len < 1e-4) return
  const nx = dx / len
  const nz = dz / len
  const depthScale = Math.min(1, depth)
  const force = params.carCollisionPushForce * rear.mass * depthScale
  const btForce = new Ammo.btVector3(nx * force, 0, nz * force)
  rear.collisionMesh.body.ammo.applyCentralForce(btForce)
  Ammo.destroy(btForce)

  if (!contact?.point) return
  const point = rear._contactPoint ?? (rear._contactPoint = new THREE.Vector3())
  const normal = rear._contactNormal ?? (rear._contactNormal = new THREE.Vector3())
  point.set(contact.point.x, contact.point.y, contact.point.z)
  normal.set(contact.normalOnB.x, contact.normalOnB.y, contact.normalOnB.z)
  // normalOnB points toward A; flip when rear is B so normal always points into rear.
  if (rear.carGhostUserIndex === contact.indexB) normal.negate()
  rear._desiredContact = { point, normal, depth }
}

// TODO do we need a class?
class CarCollisionManager {
  constructor(physicsWorld) {
    this.physicsWorld = physicsWorld
    this.vehicles = []
    this.localVehicle = null
    this._pairContacts = new Map()
    this._fwdA = new THREE.Vector3()
    this._fwdB = new THREE.Vector3()
    ensureGhostPairCallback(physicsWorld)
  }

  register(vehicle) {
    attachCarGhost(vehicle)
    this.vehicles.push(vehicle)
  }

  update(dt = 1 / 60) {
    if (!params.carCollisionEnabled) {
      for (const vehicle of this.vehicles) {
        vehicle.applyCollisionPushTint(0)
        clearContactOverlay(vehicle)
        vehicle.updateCollisionGrayOut()
      }
      carCollisionDebug.overlapping = false
      carCollisionDebug.branch = 'none'
      return
    }

    for (const vehicle of this.vehicles) {
      vehicle._desiredPushTint = 0
      vehicle._desiredContact = null
    }

    collectPairContacts(this.physicsWorld, this._pairContacts)

    const handled = new Set()
    let resolved = false
    for (const vehicle of this.vehicles) {
      if (vehicle.exploding || !vehicle.carGhost) continue
      const n = vehicle.carGhost.getNumOverlappingObjects()
      for (let i = 0; i < n; i++) {
        const otherObj = vehicle.carGhost.getOverlappingObject(i)
        const otherIndex = otherObj.getUserIndex()
        const other = vehiclesByGhostUserIndex.get(otherIndex)
        if (!other || other === vehicle || other.exploding) continue

        const key = pairKey(vehicle.carGhostUserIndex, other.carGhostUserIndex)
        if (handled.has(key)) continue
        handled.add(key)

        this.resolvePair(vehicle, other, this._pairContacts.get(key) ?? null)
        resolved = true
      }
    }

    if (!resolved) {
      carCollisionDebug.overlapping = false
      carCollisionDebug.speedA = 0
      carCollisionDebug.speedB = 0
      carCollisionDebug.speedDiff = 0
      carCollisionDebug.fwdDot = 0
      carCollisionDebug.depth = 0
      carCollisionDebug.branch = 'none'
    }

    for (const vehicle of this.vehicles) {
      vehicle.applyCollisionPushTint(vehicle._desiredPushTint)
      updateContactHeat(vehicle, vehicle._desiredContact, dt)
      vehicle.updateCollisionGrayOut()
      syncCarGhost(vehicle)
    }
  }

  resolvePair(a, b, contact) {
    const depth = contact?.depth ?? 0
    const speedA = Math.abs(a.getSpeed())
    const speedB = Math.abs(b.getSpeed())
    const speedDiff = speedDiffRatio(a, b)
    const fwdA = horizontalForward(a, this._fwdA)
    const fwdB = horizontalForward(b, this._fwdB)
    const fwdDot = fwdA.dot(fwdB)

    carCollisionDebug.overlapping = true
    carCollisionDebug.speedA = speedA
    carCollisionDebug.speedB = speedB
    carCollisionDebug.speedDiff = speedDiff
    carCollisionDebug.fwdDot = fwdDot
    carCollisionDebug.depth = depth

    if (speedDiff > params.carCollisionSpeedDiffThreshold) {
      carCollisionDebug.branch = 'speedDiffGray'
      if (a !== this.localVehicle) a.startCollisionGrayOut(1000)
      if (b !== this.localVehicle) b.startCollisionGrayOut(1000)
      return
    }

    if (fwdDot <= params.carCollisionSameDirDot) {
      carCollisionDebug.branch = 'oppositeDirSkip'
      return
    }

    carCollisionDebug.branch = 'softPushRear'
    const { rear, front } = rearAndFront(a, b, fwdA, fwdB)
    softPushRear(rear, front, contact)
  }
}

export { CarCollisionManager, attachCarGhost, syncCarGhost }
