import { updateContactHeat, clearContactOverlay, triggerHeatWave, hasActiveHeatWave } from './contactOverlay.js'
import { Config } from './config.js'

export const GROUP_TRACK = 1
export const GROUP_CAR = 2
export const GROUP_CAR_SENSOR = 4

const CF_NO_CONTACT_RESPONSE = 4
const MIN_CONTACT_DEPTH = 0.01

let nextGhostUserIndex = 1
const vehiclesByGhostUserIndex = new Map()
let ghostPairCallbackInstalled = false

function ensureGhostPairCallback(physicsWorld) {
  if (ghostPairCallbackInstalled) return
  const callback = new Ammo.btGhostPairCallback()
  physicsWorld.getPairCache().setInternalGhostPairCallback(callback)
  ghostPairCallbackInstalled = true
}

function attachCarGhost(vehicle) {
  ensureGhostPairCallback(vehicle.physics.physicsWorld)

  const shape = vehicle.collisionMesh.body.ammo.getCollisionShape()
  const ghost = new Ammo.btPairCachingGhostObject()
  ghost.setCollisionShape(shape)
  ghost.setCollisionFlags(CF_NO_CONTACT_RESPONSE)

  const userIndex = nextGhostUserIndex++
  ghost.setUserIndex(userIndex)
  vehiclesByGhostUserIndex.set(userIndex, vehicle)

  vehicle.physics.physicsWorld.addCollisionObject(ghost, GROUP_CAR_SENSOR, GROUP_CAR_SENSOR)
  vehicle.carGhost = ghost
  vehicle.carGhostUserIndex = userIndex
  syncCarGhost(vehicle)
}

function syncCarGhost(vehicle) {
  if (!vehicle.carGhost) return
  vehicle.carGhost.setWorldTransform(vehicle.vehicle.getChassisWorldTransform())
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

function maxManifoldDepth(manifold) {
  let depth = 0
  const contactCount = manifold.getNumContacts()
  for (let j = 0; j < contactCount; j++) {
    depth = Math.max(depth, -manifold.getContactPoint(j).getDistance())
  }
  return depth
}

function collectGhostPairDepths(physicsWorld, pairKeys, out) {
  out.clear()
  const dispatcher = physicsWorld.getDispatcher()
  for (let i = 0; i < dispatcher.getNumManifolds(); i++) {
    const manifold = dispatcher.getManifoldByIndexInternal(i)
    const body0 = Ammo.castObject(manifold.getBody0(), Ammo.btCollisionObject)
    const body1 = Ammo.castObject(manifold.getBody1(), Ammo.btCollisionObject)
    const indexA = body0.getUserIndex()
    const indexB = body1.getUserIndex()
    if (!vehiclesByGhostUserIndex.has(indexA) || !vehiclesByGhostUserIndex.has(indexB)) continue

    const key = pairKey(indexA, indexB)
    if (!pairKeys.has(key)) continue

    const depth = maxManifoldDepth(manifold)
    if (depth > MIN_CONTACT_DEPTH) out.set(key, depth)
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
  if ((dx * avgX + dz * avgZ) / len > 0) return { rear: a, front: b }
  return { rear: b, front: a }
}

function softPushRear(rear, front, depth) {
  const dx = rear.collisionMesh.position.x - front.collisionMesh.position.x
  const dz = rear.collisionMesh.position.z - front.collisionMesh.position.z
  const len = Math.hypot(dx, dz)
  if (len < 1e-4) return
  const nx = dx / len
  const nz = dz / len
  const depthScale = Math.min(1, depth)
  const force = Config.carCollisionPushForce * rear.massKg * depthScale
  const btForce = new Ammo.btVector3(nx * force, 0, nz * force)
  rear.collisionMesh.body.ammo.applyCentralForce(btForce)
  Ammo.destroy(btForce)

  if (!hasActiveHeatWave(rear)) {
    const dir = rear._waveDir ?? (rear._waveDir = new THREE.Vector3())
    dir.set(nx, 0, nz)
    triggerHeatWave(rear, front.collisionMesh.position, dir)
  }
}

class CarCollisionManager {
  constructor(physicsWorld) {
    this.physicsWorld = physicsWorld
    this.vehicles = []
    this.localVehicle = null
    this._pairDepths = new Map()
    this._fwdA = new THREE.Vector3()
    this._fwdB = new THREE.Vector3()
    ensureGhostPairCallback(physicsWorld)
  }

  register(vehicle) {
    attachCarGhost(vehicle)
    this.vehicles.push(vehicle)
  }

  postPhysicsUpdate(dt = 1 / 60) {
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
    }

    const pairKeys = new Set()
    const pairs = []
    for (const vehicle of this.vehicles) {
      if (vehicle.exploding || !vehicle.carGhost) continue
      const n = vehicle.carGhost.getNumOverlappingObjects()
      for (let i = 0; i < n; i++) {
        const other = vehiclesByGhostUserIndex.get(vehicle.carGhost.getOverlappingObject(i).getUserIndex())
        if (!other || other === vehicle || other.exploding) continue

        const key = pairKey(vehicle.carGhostUserIndex, other.carGhostUserIndex)
        if (pairKeys.has(key)) continue
        pairKeys.add(key)
        pairs.push([vehicle, other, key])
      }
    }

    let resolved = false
    if (pairs.length) {
      collectGhostPairDepths(this.physicsWorld, pairKeys, this._pairDepths)
      for (const [a, b, key] of pairs) {
        if (this.resolvePair(a, b, this._pairDepths.get(key) ?? 0)) resolved = true
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
      updateContactHeat(vehicle, dt)
      vehicle.updateCollisionGrayOut()
    }

    for (const vehicle of this.vehicles) {
      syncCarGhost(vehicle)
    }
  }

  resolvePair(a, b, depth) {
    if (depth <= MIN_CONTACT_DEPTH) return false

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
      return true
    }

    if (fwdDot <= params.carCollisionSameDirDot) {
      carCollisionDebug.branch = 'oppositeDirSkip'
      return true
    }

    carCollisionDebug.branch = 'softPushRear'
    const { rear, front } = rearAndFront(a, b, fwdA, fwdB)
    softPushRear(rear, front, depth)
    return true
  }
}

export { CarCollisionManager, attachCarGhost, syncCarGhost }
