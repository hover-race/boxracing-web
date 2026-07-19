class CarModelDefinition {
  constructor({
    car_id,
    displayName,
    file,
    sceneName,
    visualRoot,
    chassis,
    wheels,
    wheelRadiusFront = 0.24,
    wheelRadiusBack = 0.24,
    wheelbase = 2.6,
    mass = 800,
  }) {
    this.car_id = car_id
    this.displayName = displayName
    this.file = file
    this.sceneName = sceneName
    this.visualRoot = visualRoot
    this.chassis = chassis
    this.wheels = wheels
    this.wheelRadiusFront = wheelRadiusFront
    this.wheelRadiusBack = wheelRadiusBack
    this.wheelbase = wheelbase
    this.mass = mass
  }

  selectScene(gltf) {
    const scene = gltf.scenes.find(candidate => candidate.name === this.sceneName)
    if (!scene) throw new Error(`${this.displayName}: scene "${this.sceneName}" not found`)
    return scene
  }
}

class MustangCarModel extends CarModelDefinition {
  constructor() {
    super({
      car_id: 'mustang',
      displayName: 'Mustang',
      file: 'assets/glb/red-mustang-bigwheel2.glb',
      sceneName: 'Scene',
      visualRoot: 'Body001',
      chassis: 'Plane002',
      wheels: {
        frontLeft: 'FrontLeftWheel',
        frontRight: 'FrontRightWheel',
        rearLeft: 'RearLeftWheel',
        rearRight: 'RearRightWheel',
      },
    })
  }
}

class MonteCarloCarModel extends CarModelDefinition {
  constructor() {
    super({
      car_id: 'monte_carlo',
      displayName: 'Monte Carlo',
      file: 'assets/glb/green-monte-carlo.glb',
      sceneName: 'MonteCarlo',
      visualRoot: 'CarsGreenMonteCarlo001',
      chassis: 'bodyMesh_ChickHicks_Body002',
      wheels: {
        frontLeft: '!Wheel2',
        frontRight: 'Wheel1',
        rearLeft: '!Wheel1',
        rearRight: 'Wheel2',
      },
      wheelRadiusFront: 0.39,
      wheelRadiusBack: 0.39,
      wheelbase: 2.69,
    })
  }
}

const CAR_MODELS = [
  new MustangCarModel(),
  new MonteCarloCarModel(),
]

const CAR_MODELS_BY_ID = new Map(CAR_MODELS.map(model => [model.car_id, model]))

function getCarModel(car_id) {
  return CAR_MODELS_BY_ID.get(car_id) || CAR_MODELS_BY_ID.get('mustang')
}

function findPart(root, name, carModel) {
  const part = root.getObjectByName(name)
  if (!part) throw new Error(`${carModel.displayName}: part "${name}" not found`)
  return part
}

function cloneMaterials(root) {
  root.traverse(child => {
    if (!child.isMesh || !child.material) return
    child.material = Array.isArray(child.material)
      ? child.material.map(material => material.clone())
      : child.material.clone()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if ('metalness' in material) material.metalness = 0
    }
    child.castShadow = true
    child.receiveShadow = true
  })
}

function createWheelVisual(modelRoot, source, name) {
  const bounds = new THREE.Box3().setFromObject(source)
  const center = bounds.getCenter(new THREE.Vector3())
  const wheel = new THREE.Group()
  wheel.name = name
  wheel.position.copy(center)
  modelRoot.add(wheel)
  wheel.attach(source)
  return wheel
}

function extractCarParts(modelRoot, carModel) {
  cloneMaterials(modelRoot)
  modelRoot.updateMatrixWorld(true)

  const visualRoot = findPart(modelRoot, carModel.visualRoot, carModel)
  const bodyMesh = findPart(modelRoot, carModel.chassis, carModel)
  if (!bodyMesh.isMesh) throw new Error(`${carModel.displayName}: chassis must be a mesh`)

  const wheelSources = {
    frontLeft: findPart(modelRoot, carModel.wheels.frontLeft, carModel),
    frontRight: findPart(modelRoot, carModel.wheels.frontRight, carModel),
    rearLeft: findPart(modelRoot, carModel.wheels.rearLeft, carModel),
    rearRight: findPart(modelRoot, carModel.wheels.rearRight, carModel),
  }

  const wheels = {}
  for (const [position, source] of Object.entries(wheelSources)) {
    wheels[position] = createWheelVisual(modelRoot, source, position)
  }

  const collisionGeometry = bodyMesh.geometry.clone()
  collisionGeometry.applyMatrix4(bodyMesh.matrixWorld)
  const collisionMaterial = new THREE.MeshBasicMaterial({ visible: false })
  const chassis = new THREE.Mesh(collisionGeometry, collisionMaterial)
  chassis.name = `${carModel.car_id}_chassis`
  chassis.userData.isCollisionMesh = true
  modelRoot.add(chassis)
  chassis.attach(visualRoot)

  return { chassis, wheels }
}

export {
  CAR_MODELS,
  CAR_MODELS_BY_ID,
  getCarModel,
  extractCarParts,
}
