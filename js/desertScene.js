export class DesertScene extends Scene3D {
  async loadGltf(path) {
    const obj = await this.load.gltf(path)
    const scene = obj.scenes[0]
    scene.traverse(child => {
      if (child.material) {
        child.material.metalness = 0;
      }
    })
    this.add.existing(scene)
    return scene
  }

  async create() {
    const { lights, orbitControls } = await this.warpSpeed('-ground', '-sky', '-light')
    this.orbitControls = orbitControls
    this.camera.fov = 70
    this.camera.updateProjectionMatrix()

    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0)
    this.scene.add(ambientLight)

    // Add directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(10, 10, 5)
    this.scene.add(directionalLight)

    // Create checkerboard texture
    const checkerboardSize = 64
    const canvas = document.createElement('canvas')
    canvas.width = checkerboardSize
    canvas.height = checkerboardSize
    const ctx = canvas.getContext('2d')

    // Brown and gray colors
    const brownColor = '#8B6F47'  // Brown
    const grayColor = '#6B6B6B'    // Gray

    // Draw checkerboard pattern
    const tileSize = checkerboardSize / 8  // 8x8 checkerboard
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? brownColor : grayColor
        ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize)
      }
    }

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas)
    // Pixel-perfect nearest filtering - set before other properties
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.generateMipmaps = false
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(3, 3)
    texture.needsUpdate = true

    // Create plane geometry
    const planeSize = 100
    const planeGeometry = new THREE.PlaneGeometry(planeSize, planeSize)
    // Use MeshBasicMaterial to avoid lighting effects that might blur the texture
    const planeMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide
    })

    const plane = new THREE.Mesh(planeGeometry, planeMaterial)
    plane.rotation.x = -Math.PI / 2  // Rotate to be horizontal
    plane.position.y = 0
    this.scene.add(plane)

    // Add physics to the plane
    this.physics.add.existing(plane, { collisionFlags: 1, mass: 0, shape: 'box' })

    // Load truck model
    const truck = await this.loadGltf('assets/glb/3-axes-truck.glb')
    truck.position.set(0, 0, 0)  // Position above the plane

    // Position camera to look at the plane
    this.camera.position.set(0, 10, 15)
    this.camera.lookAt(0, 0, 0)
  }

  update() {
    // Empty update method
  }
}

