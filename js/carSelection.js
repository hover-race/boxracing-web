import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.156.1/examples/jsm/loaders/GLTFLoader.js'
import { CAR_MODELS, getCarModel, selectScene } from './carModels.js'

class CarPreview {
  constructor(canvas) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setClearColor(0x000000, 0)

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100)
    this.camera.position.set(3.2, 1.4, 5.2)
    this.camera.lookAt(0, 0.4, 0)

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.4))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(4, 8, 2)
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.5)
    fill.position.set(-4, 2, -3)
    this.scene.add(fill)

    this.pivot = new THREE.Group()
    this.scene.add(this.pivot)
    this.loader = new GLTFLoader()
    this.cache = new Map()
    this.currentModel = null
    this.raf = 0
    this.alive = true
    this._onResize = () => this.resize()
    window.addEventListener('resize', this._onResize)
    this.resize()
    this.tick()
  }

  resize() {
    const w = this.canvas.clientWidth || 1
    const h = this.canvas.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  async show(carModel) {
    if (this.currentCarId === carModel.car_id) return

    this.loadToken = (this.loadToken || 0) + 1
    const token = this.loadToken
    let root = this.cache.get(carModel.car_id)
    if (!root) {
      const gltf = await this.loader.loadAsync(carModel.file)
      if (!this.alive || token !== this.loadToken) return
      const model = selectScene(carModel, gltf).clone(true)
      model.traverse(child => {
        if (child.material && 'metalness' in child.material) child.material.metalness = 0
      })
      // Fit once into a wrapper so re-selecting never accumulates transforms.
      root = new THREE.Group()
      root.add(model)
      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      model.position.sub(center)
      model.position.y += size.y * 0.08
      root.scale.setScalar(3.2 / Math.max(size.x, size.y, size.z, 0.001))
      this.cache.set(carModel.car_id, root)
    }
    if (!this.alive || token !== this.loadToken) return

    if (this.currentModel) this.pivot.remove(this.currentModel)
    this.currentModel = root
    this.currentCarId = carModel.car_id
    this.pivot.add(root)
  }

  tick() {
    if (!this.alive) return
    this.pivot.rotation.y += 0.012
    this.renderer.render(this.scene, this.camera)
    this.raf = requestAnimationFrame(() => this.tick())
  }

  dispose() {
    this.alive = false
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this._onResize)
    this.renderer.dispose()
    this.cache.clear()
  }
}

function selectCar() {
  const overlay = document.getElementById('car-selection')
  const options = document.getElementById('car-selection-options')
  const startButton = document.getElementById('car-selection-start')
  const canvas = document.getElementById('car-selection-canvas')
  let selectedCar = getCarModel(params.car_id)
  let preview = null

  function finish(carId) {
    params.car_id = carId
    localStorage.setItem('car_id', carId)
    preview?.dispose()
    overlay.remove()
    return carId
  }

  if (params.skipIntro) {
    return Promise.resolve(finish(selectedCar.car_id))
  }

  preview = new CarPreview(canvas)

  function updateSelection() {
    for (const button of options.querySelectorAll('[data-car-id]')) {
      button.classList.toggle('selected', button.dataset.carId === selectedCar.car_id)
    }
    preview.show(selectedCar)
  }

  for (const carModel of CAR_MODELS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'car-selection-card'
    button.dataset.carId = carModel.car_id
    button.textContent = carModel.displayName
    button.addEventListener('click', () => {
      selectedCar = carModel
      updateSelection()
    })
    options.appendChild(button)
  }
  updateSelection()

  return new Promise(resolve => {
    startButton.addEventListener('click', () => {
      resolve(finish(selectedCar.car_id))
    }, { once: true })
  })
}

export { selectCar }
