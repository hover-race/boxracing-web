const RANGE_M = 50
const SIZE_MIN = 12
const SIZE_MAX = 40
const EDGE_PAD = 10

export class OffscreenMarkers {
  constructor() {
    this.el = document.getElementById('offscreen-markers')
    if (!this.el) throw new Error('offscreen-markers element missing')
    this._local = new THREE.Vector3()
    this._world = new THREE.Vector3()
    this._frustum = new THREE.Frustum()
    this._proj = new THREE.Matrix4()
  }

  update(mainScene) {
    const player = mainScene.car
    const camera = mainScene.camera
    if (!player?.visualRoot || !camera) {
      this._show(0)
      return
    }

    camera.updateMatrixWorld()
    this._proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this._frustum.setFromProjectionMatrix(this._proj)

    const playerPos = player.visualRoot.position
    let used = 0

    for (const car of this._opponents(mainScene)) {
      const root = car.visualRoot
      if (!root?.visible) continue

      const pos = root.getWorldPosition(this._world)
      const dist = playerPos.distanceTo(pos)
      if (dist > RANGE_M || dist < 0.5) continue
      if (this._frustum.containsPoint(pos)) continue

      const marker = this._marker(used++)
      this._place(marker, camera, pos, dist, root.userData.botColor)
    }

    this._show(used)
  }

  _opponents(mainScene) {
    const cars = []
    for (const { car } of mainScene.bots ?? []) if (car) cars.push(car)
    if (mainScene.remoteManager) {
      for (const car of mainScene.remoteManager.remoteCars.values()) cars.push(car)
    }
    return cars
  }

  _place(marker, camera, worldPos, dist, color) {
    const local = this._local.copy(worldPos)
    camera.worldToLocal(local)

    let dx = local.x
    let dy = -local.y
    if (dx === 0 && dy === 0) dy = local.z > 0 ? 1 : -1

    const w = window.innerWidth
    const h = window.innerHeight
    const closeness = 1 - dist / RANGE_M
    const size = SIZE_MIN + (SIZE_MAX - SIZE_MIN) * closeness
    const pad = EDGE_PAD + size * 0.5
    const halfW = w * 0.5 - pad
    const halfH = h * 0.5 - pad

    const t = Math.min(halfW / Math.abs(dx), halfH / Math.abs(dy))
    const px = w * 0.5 + dx * t
    const py = h * 0.5 + dy * t
    const angle = Math.atan2(dx, -dy)

    marker.style.setProperty('--s', `${size}px`)
    marker.style.setProperty('--c', color?.getStyle?.() ?? '#fff')
    marker.style.left = `${px}px`
    marker.style.top = `${py}px`
    marker.style.transform = `translate(-50%, 0) rotate(${angle}rad)`
  }

  _marker(i) {
    while (this.el.children.length <= i) {
      const node = document.createElement('div')
      node.className = 'offscreen-marker'
      this.el.appendChild(node)
    }
    return this.el.children[i]
  }

  _show(count) {
    for (let i = 0; i < this.el.children.length; i++) {
      this.el.children[i].hidden = i >= count
    }
  }
}
