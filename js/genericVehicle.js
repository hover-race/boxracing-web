import { Wheel } from './wheel.js';

class GenericVehicle {
  vehicle
  tuning

  wheelMeshes = []
  wheels = []  // Array to store Wheel instances

  engineForce = 0
  vehicleSteering = 0
  breakingForce = 0

  steeringIncrement = 0.04
  steeringClamp = 0.3
  maxEngineForce = 3000
  maxBrakingForce = 100

  constructor(scene, physics, chassis, wheelConfigs, nodeHandlers = {}) {
    this.scene = scene
    this.physics = physics
    this.chassis = chassis
    this.wheelConfigs = wheelConfigs
    this.nodeHandlers = nodeHandlers
    this.wheels = []
    this.wheelMeshes = []

    const { physicsWorld } = physics

    this.tuning = new Ammo.btVehicleTuning()
    const rayCaster = new Ammo.btDefaultVehicleRaycaster(physicsWorld)
    this.vehicle = new Ammo.btRaycastVehicle(this.tuning, chassis.body.ammo, rayCaster)

    // do not automatically sync the mesh to the physics body
    chassis.body.skipUpdate = true

    this.vehicle.setCoordinateSystem(0, 1, 2)
    physicsWorld.addAction(this.vehicle)

    // Add wheels based on configuration
    wheelConfigs.forEach((config, index) => {
      this.addWheel(
        config.mesh,
        config.isFront || false,
        config.radius || 0.4,
        config.suspensionStiffness,
        config.suspensionDampingRelaxation,
        config.suspensionDampingCompression,
        config.suspensionRestLength,
        config.frictionSlip,
        config.rollInfluence
      )
    })

    this.speedometer = document.getElementById('speedometer')

    // Initialize wheels array after adding wheels to vehicle
    this.wheels = this.wheelMeshes.map((mesh, index) => {
      const wheelInfo = this.vehicle.getWheelInfo(index);
      const config = wheelConfigs[index];
      const radius = config.radius || 0.4;
      return new Wheel(this.chassis.body.ammo, wheelInfo, radius);
    });

    // Initialize decal system
    this.decalMaterial = new THREE.MeshPhongMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    })

    this.decals = new THREE.Group()
    scene.add(this.decals)
  }

  applyPushForce() {
    const basis = this.chassis.body.ammo.getWorldTransform().getBasis();
    const forward = new Ammo.btVector3(
      basis.getRow(0).z(),
      basis.getRow(1).z(),
      basis.getRow(2).z() 
    )
    this.chassis.body.ammo.applyCentralForce(forward.op_mul(params.pushForce * 500))
  }

  update(keys) {
    this.updateControls(keys)
    let tm, p, q, i
    const n = this.vehicle.getNumWheels()
    for (i = 0; i < n; i++) {
      tm = this.vehicle.getWheelTransformWS(i)
      p = tm.getOrigin()
      q = tm.getRotation()
      this.wheelMeshes[i].position.set(p.x(), p.y(), p.z())
      this.wheelMeshes[i].quaternion.set(q.x(), q.y(), q.z(), q.w())
      this.wheelMeshes[i].rotateY(Math.PI)
    }

    tm = this.vehicle.getChassisWorldTransform()
    p = tm.getOrigin()
    q = tm.getRotation()

    this.chassis.position.set(p.x(), p.y(), p.z())
    this.chassis.quaternion.set(q.x(), q.y(), q.z(), q.w())
    
    const speed = this.vehicle.getCurrentSpeedKmHour() * 0.621371
    if (this.speedometer) {
      this.speedometer.textContent = `${speed.toFixed(0)} mph`
    }

    // Update wheel physics
    const dt = 1/60;
    this.wheels.forEach((wheel, index) => {
      const config = this.wheelConfigs[index];
      if (config && config.updateWheel !== false) {
        wheel.update(dt, this.engineForce, this.brakingForce, this.inputs)
      }
    })

    this.applyTorqueSteering()
    this.updateSound()
  }

  applyTorqueSteering() {
    const normalizedSteering = this.vehicleSteering / this.steeringClamp
    
    // Apply torque around up axis when steering
    const upAxis = new Ammo.btVector3(0, 1, 0);
    const torque = upAxis.op_mul(normalizedSteering * 1000)
    this.chassis.body.ammo.applyLocalTorque(torque);
  }

  updateSound() {
    if (this.chassis.engineSound) {
      const speed = this.vehicle.getCurrentSpeedKmHour() * 0.621371
      this.chassis.engineSound.setVolume(Math.min(1, speed / 100))
      this.chassis.engineSound.volume = params.engineVolume
      const minPitch = 0.5
      const maxPitch = 2.0
      const pitch = minPitch + (maxPitch - minPitch) * (speed / 100)
      this.chassis.engineSound.setPlaybackRate(Math.min(maxPitch, Math.max(minPitch, pitch)))
    }
  }

  addWheel(
    wheelMesh,
    isFront,
    radius,
    suspensionStiffness = 50.0,
    suspensionDampingRelaxation = 3,
    suspensionDampingCompression = 4.4,
    suspensionRestLength = 0,
    frictionSlip = 2,
    rollInfluence = 1
  ) {
    const pos = new Ammo.btVector3(wheelMesh.position.x, wheelMesh.position.y, wheelMesh.position.z)
    var maxSuspensionTravelCm = 500

    this.tuning.maxSuspensionTravelCm = maxSuspensionTravelCm

    const wheelDirectionCS0 = new Ammo.btVector3(0, -1, 0)
    const wheelAxleCS = new Ammo.btVector3(-1, 0, 0)

    const wheelInfo = this.vehicle.addWheel(
      pos,
      wheelDirectionCS0,
      wheelAxleCS,
      suspensionRestLength,
      radius,
      this.tuning,
      isFront
    )

    wheelInfo.set_m_suspensionStiffness(suspensionStiffness)
    wheelInfo.set_m_wheelsDampingRelaxation(suspensionDampingRelaxation)
    wheelInfo.set_m_wheelsDampingCompression(suspensionDampingCompression)
    wheelInfo.set_m_frictionSlip(frictionSlip)
    wheelInfo.set_m_rollInfluence(rollInfluence)

    this.wheelMeshes.push(wheelMesh)
    this.scene.add(wheelMesh)
  }

  updateControls(keys) {
    // Normalize inputs to -1 to 1 range
    this.inputs = {
      brake: (keys.space || (this.getSpeed() > 1 && keys.s)) ? 1 : 0,
      throttle: keys.w ? 1 : (keys.s ? 0 : 0),
      steering: keys.a ? 1 : (keys.d ? -1 : 0)
    }
    
    // front/back
    if (keys.w) this.engineForce = this.maxEngineForce
    else if (keys.s) this.engineForce = -2 * this.maxEngineForce
    else this.engineForce = 0

    // left/right
    if (keys.a) {
      if (this.vehicleSteering < this.steeringClamp) 
        this.vehicleSteering += this.steeringIncrement
    } else if (keys.d) {
      if (this.vehicleSteering > -this.steeringClamp) 
        this.vehicleSteering -= this.steeringIncrement
    } else {
      if (this.vehicleSteering > 0) 
        this.vehicleSteering -= this.steeringIncrement / 2
      if (this.vehicleSteering < 0) 
        this.vehicleSteering += this.steeringIncrement / 2
      if (Math.abs(this.vehicleSteering) <= this.steeringIncrement) 
        this.vehicleSteering = 0
    }

    // brake
    this.brakingForce = keys.space ? this.maxBrakingForce : 0

    // Apply forces to wheels based on configuration
    this.wheelConfigs.forEach((config, index) => {
      if (config.applyEngineForce !== false) {
        this.vehicle.applyEngineForce(this.engineForce, index)
      }
      if (config.canSteer) {
        this.vehicle.setSteeringValue(this.vehicleSteering, index)
      }
      if (config.canBrake !== false) {
        this.vehicle.setBrake(this.brakingForce, index)
      }
    })
  }

  getSpeed() {
    return this.vehicle.getCurrentSpeedKmHour()
  }

  /**
   * Static factory method to create a GenericVehicle from a GLB file
   * @param {Scene3D} scene - The enable3d scene
   * @param {Object} transform - Transform with position and quaternion
   * @param {string} glbPath - Path to the GLB file
   * @param {Array} wheelConfigs - Array of wheel configurations
   *   Each config should have:
   *   - nodeName: string - Name of the wheel node in the GLB
   *   - isFront: boolean - Whether this wheel can steer
   *   - radius: number - Wheel radius
   *   - canSteer: boolean - Whether this wheel can steer (defaults to isFront)
   *   - applyEngineForce: boolean - Whether to apply engine force (default true)
   *   - canBrake: boolean - Whether this wheel can brake (default true)
   *   - suspensionStiffness: number (optional)
   *   - suspensionDampingRelaxation: number (optional)
   *   - suspensionDampingCompression: number (optional)
   *   - frictionSlip: number (optional)
   *   - rollInfluence: number (optional)
   * @param {Object} nodeHandlers - Map from node name to handler function
   *   Handler function signature: (node, vehicle) => void
   *   Called for each node during traversal if the name matches
   * @param {string} chassisNodeName - Name of the chassis node (default: looks for first mesh)
   * @param {Object} preloadedModel - Optional preloaded GLTF scene to use instead of loading
   * @returns {Promise<GenericVehicle>}
   */
  static async create(
    scene,
    transform,
    glbPath,
    wheelConfigs,
    nodeHandlers = {},
    chassisNodeName = null,
    preloadedModel = null
  ) {
    let chassis = null
    const wheelMeshes = {}
    const foundWheels = {}

    let scene3D;
    if (preloadedModel) {
      scene3D = preloadedModel;
    } else {
      const gltf = await scene.load.gltf(glbPath)
      scene3D = gltf.scenes[0]
    }

    // Debug: Log all node names to help identify wheel nodes
    const allNodeNames = []
    const wheelNodeNames = []
    scene3D.traverse(child => {
      if (child.name) {
        allNodeNames.push(child.name)
        if (child.name.toLowerCase().includes('wheel')) {
          wheelNodeNames.push(child.name)
        }
      }
    })
    console.log('GenericVehicle: All node names in GLB:', allNodeNames)
    console.log('GenericVehicle: Wheel-related node names:', wheelNodeNames)

    // Traverse the model and extract nodes
    scene3D.traverse(child => {
      if (child.isMesh) {
        // Apply material modifications
        if (child.material) {
          child.material.metalness = 0;
        }

        // Check for chassis
        if (chassisNodeName) {
          if (child.name === chassisNodeName) {
            chassis = child
          }
        } else if (!chassis && child.isMesh) {
          // Default: use first mesh as chassis if no name specified
          chassis = child
        }

        // Check for wheels (direct mesh match)
        wheelConfigs.forEach((config, index) => {
          if (child.name === config.nodeName) {
            wheelMeshes[config.nodeName] = child
            foundWheels[config.nodeName] = true
            child.receiveShadow = child.castShadow = true
            if (config.centerGeometry !== false) {
              child.geometry.center()
            }
          }
        })

        // Check for wheels by parent node name (if mesh is child of wheel node)
        if (child.parent) {
          wheelConfigs.forEach((config, index) => {
            if (child.parent.name === config.nodeName && !foundWheels[config.nodeName]) {
              wheelMeshes[config.nodeName] = child
              foundWheels[config.nodeName] = true
              child.receiveShadow = child.castShadow = true
              if (config.centerGeometry !== false) {
                child.geometry.center()
              }
            }
          })
        }

        // Apply custom node handlers
        if (nodeHandlers[child.name]) {
          nodeHandlers[child.name](child, { chassis, wheelMeshes, scene })
        }
      } else {
        // Check for wheel nodes that are Object3D (non-mesh) - find first mesh child
        wheelConfigs.forEach((config, index) => {
          if (child.name === config.nodeName && !foundWheels[config.nodeName]) {
            // Look for first mesh child
            child.traverse(descendant => {
              if (descendant.isMesh && !foundWheels[config.nodeName]) {
                wheelMeshes[config.nodeName] = descendant
                foundWheels[config.nodeName] = true
                descendant.receiveShadow = descendant.castShadow = true
                if (config.centerGeometry !== false) {
                  descendant.geometry.center()
                }
              }
            })
          }
        })

        // Apply handlers to non-mesh nodes too
        if (nodeHandlers[child.name]) {
          nodeHandlers[child.name](child, { chassis, wheelMeshes, scene })
        }
      }
    })

    // Verify all required wheels were found
    const missingWheels = wheelConfigs.filter(config => !foundWheels[config.nodeName])
    if (missingWheels.length > 0) {
      console.warn('GenericVehicle: Missing wheel nodes:', missingWheels.map(w => w.nodeName))
    }

    if (!chassis) {
      console.error('GenericVehicle: Chassis not found')
      return null
    }

    // Setup chassis
    chassis.receiveShadow = chassis.castShadow = true
    chassis.position.copy(transform.position)
    chassis.quaternion.copy(transform.quaternion)

    scene.add.existing(chassis)
    scene.physics.add.existing(chassis, { shape: 'convex', mass: 800 })
    chassis.body.setDamping(0.1, 0.1)

    // Add engine sound if handler provided
    if (nodeHandlers.engineSound) {
      nodeHandlers.engineSound(null, { chassis, scene })
    }

    // Prepare wheel configs with meshes
    const preparedWheelConfigs = wheelConfigs.map(config => ({
      ...config,
      mesh: wheelMeshes[config.nodeName],
      canSteer: config.canSteer !== undefined ? config.canSteer : config.isFront
    })).filter(config => config.mesh) // Only include wheels that were found

    return new GenericVehicle(scene.scene, scene.physics, chassis, preparedWheelConfigs, nodeHandlers)
  }

  serialize() {
    return {
      position: this.chassis.position,
      quaternion: this.chassis.quaternion,
    }
  }

  updateTireMarks() {
    this.wheels.forEach((wheel, index) => {
      const config = this.wheelConfigs[index];
      if (config && config.createTireMarks !== false) {
        this.applyDecal(wheel)
      }
    })
  }

  applyDecal(wheel) {
    const wheelInfo = wheel.wheelInfo
      
    // Check if wheel is slipping and in contact
    const slipping = Math.abs(wheel.slipRatio) > 0.1
    
    if (slipping && wheelInfo.get_m_raycastInfo().get_m_isInContact()) {
      // Get wheel contact point and normal from raycast info
      const contactPoint = wheelInfo.get_m_raycastInfo().get_m_contactPointWS()
      const position = new THREE.Vector3(contactPoint.x(), contactPoint.y(), contactPoint.z())
      
      // Get chassis rotation and steering angle
      const chassisRotation = this.chassis.quaternion
      const steeringAngle = wheelInfo.get_m_steering()
      const rotation = chassisRotation.clone()
      rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), steeringAngle))
      
      // Create decal
      const wheelWidth = 0.55

      const decalGeometry = new THREE.PlaneGeometry(wheelWidth, 1)
      decalGeometry.rotateX(-Math.PI / 2) // Align with ground

      // Scale decal length based on velocity and width based on wheel
      const speed = Math.abs(this.vehicle.getCurrentSpeedKmHour())
      const lengthScale = Math.min(1 + speed * 0.01, 3) // Scale up with speed, max 3x
      decalGeometry.scale(wheelWidth, lengthScale, 1) // Scale x by wheel width
      
      const decal = new THREE.Mesh(decalGeometry, this.decalMaterial.clone()) 
      decal.position.copy(position)
      decal.position.y += 0.01 // Slight offset to prevent z-fighting
      
      // Apply wheel rotation to decal
      decal.quaternion.copy(rotation)
      
      this.decals.add(decal)

      // Remove old decals if too many
      if (this.decals.children.length > 1000) {
        const oldDecal = this.decals.children[0]
        this.decals.remove(oldDecal)
        oldDecal.geometry.dispose()
        oldDecal.material.dispose()
      }
    }
  }
}

export { GenericVehicle };

