class CarModelDefinition {
  constructor({
    car_id,
    displayName,
    file,
    sceneName,
    visualRoot,
    chassis,
    wheels,
    wheelRadiusFront = 0.37,
    wheelRadiusBack = 0.37,
    wheelbase = 2.6,
    mass = 800,
    engineTorque = 700,
    drivenWheels = ['rearLeft', 'rearRight'],
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
    this.engineTorque = engineTorque
    this.drivenWheels = drivenWheels
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
      chassis: 'Body001',
      wheels: {
        frontLeft: 'FrontLeftWheel',
        frontRight: 'FrontRightWheel',
        rearLeft: 'RearLeftWheel',
        rearRight: 'RearRightWheel',
      },
      engineTorque: 1000,
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
      chassis: 'CollisionMesh',
      wheels: {
        frontLeft: 'Wheel1001',
        frontRight: '!Wheel2',
        rearLeft: 'Wheel2001',
        rearRight: '!Wheel1',
      },
      wheelRadiusFront: 0.39,
      wheelRadiusBack: 0.39,
      wheelbase: 2.69,
      engineTorque: 1000,
    })
  }
}

class Evo5CarModel extends CarModelDefinition {
  constructor() {
    super({
      car_id: 'evo5',
      displayName: 'Evo 5',
      file: 'assets/glb/evo5.glb',
      sceneName: 'Scene',
      visualRoot: 'Root',
      chassis: 'Body',
      wheels: {
        frontLeft: 'Wheel2',
        frontRight: 'Wheel1',
        rearLeft: 'Wheel4',
        rearRight: 'Wheel3',
      },
      wheelRadiusFront: 0.39,
      wheelRadiusBack: 0.39,
      wheelbase: 2.5,
      engineTorque: 500,
      drivenWheels: ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'],
    })
  }
}

const CAR_MODELS = [
  new MustangCarModel(),
  new MonteCarloCarModel(),
  new Evo5CarModel(),
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

function findChassisMesh(root, name, carModel) {
  const part = findPart(root, name, carModel)
  if (part.isMesh) return part
  let mesh = null
  part.traverse(child => {
    if (child.isMesh && !mesh) mesh = child
  })
  if (!mesh) throw new Error(`${carModel.displayName}: chassis "${name}" has no mesh`)
  return mesh
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
  const bodyMesh = findChassisMesh(modelRoot, carModel.chassis, carModel)

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
