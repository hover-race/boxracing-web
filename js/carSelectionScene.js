import { selectScene } from './carModels.js'

const PREVIEW_PIXEL_SCALE = 0.35

export class CarSelectionScene extends Scene3D {
  constructor() {
    super({ key: 'carSelection' })
    this._readyResolve = null
    this.ready = new Promise(resolve => {
      this._readyResolve = resolve
    })
  }

  async create() {
    this.camera.fov = 35
    this.camera.updateProjectionMatrix()
    this.camera.position.set(3.2, 1.4, 5.2)
    this.camera.lookAt(0, 0.4, 0)

    this._lights = []
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4)
    this.scene.add(ambientLight)
    this._lights.push(ambientLight)

    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(4, 8, 2)
    this.scene.add(key)
    this._lights.push(key)

    const fill = new THREE.DirectionalLight(0xffffff, 0.5)
    fill.position.set(-4, 2, -3)
    this.scene.add(fill)
    this._lights.push(fill)

    this.pivot = new THREE.Group()
    this.scene.add(this.pivot)
    this.models = new Map()
    this.loadToken = 0

    this._onResize = () => this.resizePreview()
    window.addEventListener('resize', this._onResize)
    this.resizePreview()

    this.deconstructor.add({
      dispose: () => {
        window.removeEventListener('resize', this._onResize)
        this.cleanup()
      },
    })

    this._readyResolve()
  }

  resizePreview() {
    const w = this.parent.clientWidth || 1
    const h = this.parent.clientHeight || 1
    const bufferW = Math.max(1, Math.floor(w * PREVIEW_PIXEL_SCALE))
    const bufferH = Math.max(1, Math.floor(h * PREVIEW_PIXEL_SCALE))
    this.renderer.setPixelRatio(1)
    // updateStyle=false — keep CSS stretching the canvas to fill the preview area
    this.renderer.setSize(bufferW, bufferH, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.canvas.style.width = '100%'
    this.canvas.style.height = '100%'
  }

  update() {
    this.pivot.rotation.y += 0.012
  }

  cleanup() {
    for (const light of this._lights) {
      this.scene.remove(light)
    }
    if (this.pivot) {
      this.scene.remove(this.pivot)
    }
  }

  async show(carModel) {
    if (this.currentCarId === carModel.car_id) return

    this.loadToken += 1
    const token = this.loadToken

    let root = this.models.get(carModel.car_id)
    if (!root) {
      const gltf = await this.load.gltf(carModel.file)
      if (token !== this.loadToken) return

      const model = selectScene(carModel, gltf).clone(true)
      model.traverse(child => {
        if (child.material && 'metalness' in child.material) child.material.metalness = 0
      })

      root = new THREE.Group()
      root.add(model)
      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      model.position.sub(center)
      model.position.y += size.y * 0.08
      root.scale.setScalar(3.2 / Math.max(size.x, size.y, size.z, 0.001))
      this.models.set(carModel.car_id, root)
    }
    if (token !== this.loadToken) return

    if (this.currentModel) this.pivot.remove(this.currentModel)
    this.currentModel = root
    this.currentCarId = carModel.car_id
    this.pivot.add(root)
  }
}
