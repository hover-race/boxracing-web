const DEFAULTS = {
  collisionMesh: 'CollisionMesh',
  wheelRadiusFront: 0.37,
  wheelRadiusBack: 0.37,
  wheelbase: 2.6,
  wheelTravel: 0.15,
  suspensionStiffness: 50,
  mass: 800,
  engineTorque: 700,
  drivenWheels: ['rearLeft', 'rearRight'],
}

const CAR_MODELS = [
  {
    car_id: 'mustang',
    displayName: 'Mustang',
    file: 'assets/glb/red-mustang-bigwheel2.glb',
    sceneName: 'Scene',
    visualRoot: 'Body001',
    wheels: {
      frontLeft: 'FrontLeftWheel',
      frontRight: 'FrontRightWheel',
      rearLeft: 'RearLeftWheel',
      rearRight: 'RearRightWheel',
    },
    engineTorque: 1000,
  },
  {
    car_id: 'monte_carlo',
    displayName: 'Monte Carlo',
    file: 'assets/glb/green-monte-carlo.glb',
    sceneName: 'MonteCarlo',
    visualRoot: 'CarsGreenMonteCarlo001',
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
  },
  {
    car_id: 'evo5',
    displayName: 'Evo 5',
    file: 'assets/glb/evo5.glb',
    sceneName: 'Evo5',
    visualRoot: 'Root',
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
  },
  {
    car_id: 'raptor',
    displayName: 'Raptor',
    file: 'assets/glb/raptor.glb',
    sceneName: 'Raptor',
    visualRoot: 'Raptor002',
    wheels: {
      frontLeft: 'Wheel1',
      frontRight: 'Wheel2',
      rearLeft: 'Wheel3',
      rearRight: 'Wheel4',
    },
    wheelRadiusFront: 0.5,
    wheelRadiusBack: 0.5,
    wheelbase: 3.4,
    wheelTravel: 0.4,
    suspensionStiffness: 30,
    // mass: 1200,
    engineTorque: 900,
  },
].map(model => ({ ...DEFAULTS, ...model }))

const CAR_MODELS_BY_ID = new Map(CAR_MODELS.map(model => [model.car_id, model]))

function getCarModel(car_id) {
  return CAR_MODELS_BY_ID.get(car_id) || CAR_MODELS_BY_ID.get('mustang')
}

function selectScene(carModel, gltf) {
  const scene = gltf.scenes.find(candidate => candidate.name === carModel.sceneName)
  if (!scene) throw new Error(`${carModel.displayName}: scene "${carModel.sceneName}" not found`)
  return scene
}

function findPart(root, name, carModel) {
  const part = root.getObjectByName(name)
  if (!part) throw new Error(`${carModel.displayName}: part "${name}" not found`)
  return part
}

function findCollisionMeshSource(root, name, carModel) {
  const part = findPart(root, name, carModel)
  if (part.isMesh) return part
  let mesh = null
  part.traverse(child => {
    if (child.isMesh && !mesh) mesh = child
  })
  if (!mesh) throw new Error(`${carModel.displayName}: collision mesh "${name}" has no mesh`)
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

function createWheelVisual(source, name) {
  const bounds = new THREE.Box3().setFromObject(source)
  const center = bounds.getCenter(new THREE.Vector3())
  const wheel = new THREE.Group()
  wheel.name = name
  wheel.position.copy(center)
  wheel.attach(source)
  return wheel
}

function extractCarParts(prefab, carModel) {
  cloneMaterials(prefab)
  prefab.updateMatrixWorld(true)

  const visualRoot = findPart(prefab, carModel.visualRoot, carModel)
  const sourceMesh = findCollisionMeshSource(prefab, carModel.collisionMesh, carModel)

  const wheelSources = {
    frontLeft: findPart(prefab, carModel.wheels.frontLeft, carModel),
    frontRight: findPart(prefab, carModel.wheels.frontRight, carModel),
    rearLeft: findPart(prefab, carModel.wheels.rearLeft, carModel),
    rearRight: findPart(prefab, carModel.wheels.rearRight, carModel),
  }

  const wheels = {}
  for (const [position, source] of Object.entries(wheelSources)) {
    wheels[position] = createWheelVisual(source, position)
  }

  const collisionGeometry = sourceMesh.geometry.clone()
  collisionGeometry.applyMatrix4(sourceMesh.matrixWorld)
  sourceMesh.parent?.remove(sourceMesh)

  const collisionMaterial = new THREE.MeshBasicMaterial({ visible: false })
  const collisionMesh = new THREE.Mesh(collisionGeometry, collisionMaterial)
  collisionMesh.name = `${carModel.car_id}_collisionMesh`
  collisionMesh.userData.isCollisionMesh = true
  collisionMesh.castShadow = false
  collisionMesh.receiveShadow = false

  visualRoot.parent?.remove(visualRoot)

  return { collisionMesh, visualRoot, wheels }
}

export {
  CAR_MODELS,
  CAR_MODELS_BY_ID,
  getCarModel,
  selectScene,
  extractCarParts,
}
