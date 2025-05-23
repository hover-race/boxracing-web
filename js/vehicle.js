class Vehicle {
  vehicle
  tuning

  wheelMeshes = []

  engineForce = 0
  vehicleSteering = 0
  breakingForce = 0

  steeringIncrement = 0.04
  steeringClamp = 0.3
  maxEngineForce = 3000
  maxBrakingForce = 100
  steeringSensitivity = 1.0

  FRONT_LEFT = 0
  FRONT_RIGHT = 1
  BACK_LEFT = 2
  BACK_RIGHT = 3

  wheels = []  // Array to store Wheel instances

  constructor(scene, physics, chassis, wheelMeshes) {
    this.scene = scene
    this.physics = physics
    this.chassis = chassis
    this.wheels = []

    const { physicsWorld } = physics

    this.tuning = new Ammo.btVehicleTuning()
    const rayCaster = new Ammo.btDefaultVehicleRaycaster(physicsWorld)
    this.vehicle = new Ammo.btRaycastVehicle(this.tuning, chassis.body.ammo, rayCaster)

    // do not automatically sync the mesh to the physics body
    chassis.body.skipUpdate = true

    this.vehicle.setCoordinateSystem(0, 1, 2)
    physicsWorld.addAction(this.vehicle)

    const wheelRadiusBack = 0.24
    const wheelRadiusFront = 0.24

    this.addWheel(
      wheelMeshes.frontLeft,
      true,
      wheelRadiusFront,
    )

    this.addWheel(
      wheelMeshes.frontRight,
      true,
      wheelRadiusFront,
    )

    this.addWheel(
      wheelMeshes.rearLeft,
      false,
      wheelRadiusBack,
    )

    this.addWheel(
      wheelMeshes.rearRight,
      false,
      wheelRadiusBack,
    )

    this.speedometer = document.getElementById('speedometer')

    // Initialize wheels array after adding wheels to vehicle
    this.wheels = this.wheelMeshes.map((mesh, index) => {
      const wheelInfo = this.vehicle.getWheelInfo(index);
      const radius = index < 2 ? wheelRadiusFront : wheelRadiusBack;
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

  update(inputs) {
    this.updateControls(inputs)
    
    // Check if steering sensitivity has changed in GUI
    if (vehicleParams && vehicleParams.steeringSensitivity !== this.steeringSensitivity) {
      this.steeringSensitivity = vehicleParams.steeringSensitivity;
    }
    
    // this.applyPushForce()
    let tm, p, q, i
    const n = this.vehicle.getNumWheels()
    for (i = 0; i < n; i++) {
      // this.vehicle.updateWheelTransform(i, true) // This causes jitter
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
    this.speedometer.textContent = `${speed.toFixed(0)} mph`

    // Update speed display in dat.gui
    vehicleParams.speed = speed

    // Update wheel physics
    const dt = 1/60;  // Assuming 60fps, ideally get this from the physics world

    this.wheels[this.BACK_LEFT].update(dt, this.engineForce, this.brakingForce, inputs)
    this.wheels[this.BACK_RIGHT].update(dt, this.engineForce, this.brakingForce, inputs)
    this.wheels[this.BACK_RIGHT].gui()


    // this.applyTorqueSteering()

    // this.wheels[this.FRONT_LEFT].update(dt, this.engineForce, this.brakingForce)
    // this.wheels[this.FRONT_RIGHT].update(dt, this.engineForce, this.brakingForce)
    
    // this.wheels.forEach((wheel, index) => {
      
    //   // Get engine force for this wheel
    //   let engineForce = 0;
    //   if (index === this.BACK_LEFT || index === this.BACK_RIGHT) {
    //     engineForce = this.engineForce;
    //   }
      
      
      // Update wheel physics
      // if (false && 
      //   index === this.BACK_RIGHT
      //    || 
      //   index === this.BACK_LEFT
      //   ) {
      //   // wheel.applyDebugForce()
      //   // return;
      //   wheel.update(
      //     dt,
      //     engineForce,
      //     this.brakingForce,
      //   );

      //   vehicleParams.wheelSpinVelocity = wheel.angularVelocity;
      //   vehicleParams.wheelDeltaRotation = wheel.wheelInfo.m_deltaRotation;
      // }
    // });

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
      this.chassis.engineSound.setVolume(Math.min(1, speed / 100) * (vehicleParams.volume / 100))
      const minPitch = 0.5
      const maxPitch = 2.0
      const pitch = minPitch + (maxPitch - minPitch) * (speed / 100)
      this.chassis.engineSound.setPlaybackRate(Math.min(maxPitch, Math.max(minPitch, pitch)))
    }
  }

  debugRaycast(start) {
    const raycaster = new THREE.Raycaster()
    raycaster.set(start, new THREE.Vector3(0, -1, 0))
    
    const intersects = raycaster.intersectObjects(this.scene.children, true)
    
    if (intersects.length > 0) {
      console.log('Ground mesh:', intersects[0].object.name)
    }
  }
  

  addWheel(wheelMesh, isFront, radius) {
    this.wheels.push(new Wheel(wheelMesh))
    const pos = new Ammo.btVector3(wheelMesh.position.x, wheelMesh.position.y, wheelMesh.position.z)
    var suspensionStiffness = 50.0
    var suspensionDampingRelaxation = 3
    var suspensionDampingCompression = 4.4
    var suspensionRestLength = 0
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

    wheelInfo.set_m_frictionSlip(1.5)
    wheelInfo.set_m_rollInfluence(1)
    // wheelInfo.set_m_wheelsSideFrictionStiffness(10)
    // wheelInfo.set_m_frictionSlip(10)

    this.wheelMeshes.push(wheelMesh)
    this.scene.add(wheelMesh)
  }

  updateControls(inputs) {
    // Apply forces based on input controls
    this.engineForce = this.maxEngineForce * (inputs.throttle - inputs.brake);
    
    // Apply steering with sensitivity adjustment
    const adjustedSteeringIncrement = this.steeringIncrement * this.steeringSensitivity;
    
    // Use adjusted increment in steering calculations
    const targetSteering = -this.steeringClamp * inputs.steering;
    const steeringDiff = targetSteering - this.vehicleSteering;
    if (Math.abs(steeringDiff) > adjustedSteeringIncrement) {
      this.vehicleSteering += Math.sign(steeringDiff) * adjustedSteeringIncrement;
    } else {
      this.vehicleSteering = targetSteering;
    }

    // Apply handbrake
    this.brakingForce = inputs.handbrake * this.maxBrakingForce;

    // Apply forces to wheels
    this.vehicle.applyEngineForce(this.engineForce, this.BACK_LEFT);
    this.vehicle.applyEngineForce(this.engineForce, this.BACK_RIGHT);

    this.vehicle.setSteeringValue(this.vehicleSteering, this.FRONT_LEFT);
    this.vehicle.setSteeringValue(this.vehicleSteering, this.FRONT_RIGHT);

    this.vehicle.setBrake(this.brakingForce, this.FRONT_LEFT);
    this.vehicle.setBrake(this.brakingForce, this.FRONT_RIGHT);
    this.vehicle.setBrake(this.brakingForce, this.BACK_LEFT);
    this.vehicle.setBrake(this.brakingForce, this.BACK_RIGHT);
  }

  getSpeed() {
    return this.vehicle.getCurrentSpeedKmHour()
  }


  static async setupCarMustang(scene, transform, preloadedModel) {
    let wheels = {
      frontRight: null,
      frontLeft: null, 
      rearRight: null,
      rearLeft: null
    }
    let chassis
    let tire
    let centerOfMass


    let scene3D = preloadedModel;

    scene3D.traverse(child => {
      if (child.isMesh) {
        if (child.material) {
          child.material.metalness = 0;
        }
        if (child.name === "Plane002") {
          chassis = child
          chassis.receiveShadow = chassis.castShadow = true
          chassis.position.copy(transform.position)
          chassis.quaternion.copy(transform.quaternion)
        } else if (child.name === 'FrontRightWheel') {
          wheels.frontRight = child
          tire = child
          tire.receiveShadow = tire.castShadow = true
          tire.geometry.center()
        } else if (child.name === 'FrontLeftWheel') {
          wheels.frontLeft = child
        } else if (child.name === 'RearRightWheel') {
          wheels.rearRight = child
        } else if (child.name === 'RearLeftWheel') {
          wheels.rearLeft = child
        }  
      }
    })
    console.log(wheels)

    if (!chassis || !tire) {
      console.log('chassis or tire not found')
      return null
    }

    scene.add.existing(chassis)
    scene.physics.add.existing(chassis, { shape: 'convex', mass: 800 })
    chassis.body.setDamping(0.1, 0.1)

    // Add engine sound
    const engineSound = new THREE.Audio(scene.listener) // Get the audio listener from camera
    const audioLoader = new THREE.AudioLoader()
    
    // Load saved volume or use default
    const savedVolume = Number(localStorage.getItem('engineVolume'));
    const defaultVolume = 50;
    const initialVolume = !isNaN(savedVolume) ? savedVolume : defaultVolume;
    
    audioLoader.load('assets/winston_high.wav', function(buffer) {
      engineSound.setBuffer(buffer)
      engineSound.setLoop(true)
      engineSound.setVolume(initialVolume / 100)
      chassis.engineSound = engineSound // Attach to chassis for easy access
    })

    // Add gesture detection for sound
    let hasInteracted = false
    const playSound = () => {
      if (!hasInteracted && chassis.engineSound) {
        chassis.engineSound.play()
        hasInteracted = true
      }
    }

    // Listen for first interaction via mouse, touch or keyboard
    document.addEventListener('mousedown', playSound, { once: true })
    document.addEventListener('touchstart', playSound, { once: true })
    document.addEventListener('keydown', playSound, { once: true })

    // This doesn't work. this just moves the car to the given global position. Not so easy to move CoM arbitrarily.
    // const centerOfMassTransform = new Ammo.btTransform()
    // centerOfMassTransform.setIdentity()
    // centerOfMassTransform.setOrigin(new Ammo.btVector3(centerOfMass.position.x, centerOfMass.position.y, centerOfMass.position.z))
    // chassis.body.ammo.setCenterOfMassTransform(centerOfMassTransform)

    return new Vehicle(scene.scene, scene.physics, chassis, wheels)
  }

  serialize() {
    return {
      position: {
        x: Number(this.chassis.position.x.toFixed(3)),
        y: Number(this.chassis.position.y.toFixed(3)),
        z: Number(this.chassis.position.z.toFixed(3))
      },
      quaternion: [
        Number(this.chassis.quaternion.x.toFixed(3)),
        Number(this.chassis.quaternion.y.toFixed(3)),
        Number(this.chassis.quaternion.z.toFixed(3)),
        Number(this.chassis.quaternion.w.toFixed(3))
      ],
      playerName: playerControl.name
    }
  }

  updateTireMarks() {
    this.applyDecal(this.wheels[this.BACK_LEFT])
    this.applyDecal(this.wheels[this.BACK_RIGHT])
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
      const wheelWidth = 0.45

      const decalGeometry = new THREE.PlaneGeometry(wheelWidth, 0.6)
      decalGeometry.rotateX(-Math.PI / 2) // Align with ground

      // Scale decal length based on velocity and width based on wheel
      const speed = Math.abs(this.vehicle.getCurrentSpeedKmHour())
      const lengthScale = Math.min(1 + speed * 0.01, 10) // Scale up with speed
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


class RemoteCar {
  constructor(scene, model) {
    this.scene = scene
    this.playerName = ''
    this.wheelMeshes = []
    this.lastUpdate = 0

    // Ensure model is provided
    if (!model) {
      throw new Error('Model is required for RemoteCar constructor');
    }
    
    // Use pre-loaded model
    this.setupModel(model)
  }

  setupModel(model) {
    // Clone the model to ensure unique materials
    const modelClone = model.clone()
    
    // Process the cloned model
    modelClone.traverse(child => {
      if (child.isMesh) {
        if (child.material) {
          child.material.metalness = 0;
        }
        // Make remote car semi-transparent blue
        // if (child.material) {
        //   child.material = child.material.clone()
        //   child.material.color.setHex(0x0000ff)
        //   child.material.transparent = true
        //   child.material.opacity = 0.7
        // }

        if (child.name === "Plane002") {
          this.chassis = child
        } else if (child.name.includes('Wheel')) {
          this.wheelMeshes.push(child)
        }
      }
    })

    this.wheelMeshes.forEach(wheelMesh => {
      this.chassis.add(wheelMesh)
    })

    if (this.chassis) {
      this.scene.add.existing(this.chassis)
    }
  }

  deserialize(data) {
    if (this.chassis && data.position && data.quaternion) {
      this.chassis.position.copy(data.position)
      // Copy doesn't work
      this.chassis.quaternion.fromArray(data.quaternion)
    } else {
      console.warn('chassis or data.position or data.quaternion not found')
    }
    
    // Use wheelMeshes instead of wheels, and check if data.wheelRotations exists
    if (this.wheelMeshes && data.wheelRotations) {
      this.wheelMeshes.forEach((wheel, index) => {
        if (index < data.wheelRotations.length) {
          wheel.rotation.y = data.wheelRotations[index]
        }
      })
    }

    if (data.playerName) {
      // Truncate player name if longer than 12 characters
      if (data.playerName.length > 12) {
        this.playerName = data.playerName.substring(0, 12) + '.';
      } else {
        this.playerName = data.playerName;
      }
      this.updateNameBillboard();
    }

    this.lastUpdate = Date.now()
  }

  destroy() {
    this.scene.scene.remove(this.chassis)
  }

  updateNameBillboard() {
    // Create or update the player name billboard
    if (!this.nameBillboard && this.chassis) {
      // Create canvas for the text
      const canvas = document.createElement('canvas')
      canvas.width = 612
      canvas.height = 128
      
      // Get 2D context to draw text
      const context = canvas.getContext('2d', { antialias: false })
      
      // Disable image smoothing for pixel-perfect rendering
      context.imageSmoothingEnabled = false
      context.webkitImageSmoothingEnabled = false
      context.mozImageSmoothingEnabled = false
      context.msImageSmoothingEnabled = false
      
      // Create texture from canvas
      const texture = new THREE.CanvasTexture(canvas)
      
      // Use nearest neighbor filtering for the texture
      texture.magFilter = THREE.NearestFilter
      texture.minFilter = THREE.NearestFilter
      
      // Create material with the texture
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true
      })
      
      // Create sprite with the material
      this.nameBillboard = new THREE.Sprite(material)
      this.nameBillboard.scale.set(3, 0.75, 1)  // Larger scale
      this.nameBillboard.position.set(0, 3, 0)  // Position higher above car
      
      // Add to chassis
      this.chassis.add(this.nameBillboard)
      
      // Store for later updates
      this.nameCanvas = canvas
      this.nameContext = context
      this.nameTexture = texture
    }
    
    // Update the billboard text if it exists
    if (this.nameContext && this.nameCanvas && this.nameTexture) {
      const ctx = this.nameContext
      const canvas = this.nameCanvas
      
      // Ensure image smoothing is disabled
      ctx.imageSmoothingEnabled = false
      ctx.webkitImageSmoothingEnabled = false
      ctx.mozImageSmoothingEnabled = false
      ctx.msImageSmoothingEnabled = false
      
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      
      // Draw background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'  // Darker background for better contrast
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      
      // Draw text with wider character spacing
      ctx.font = 'bold 72px Arial, sans-serif'
      ctx.fillStyle = 'white'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      
      // Convert to uppercase for better legibility
      const displayName = (this.playerName || 'Player').toUpperCase();
      
      // Draw with wider letter spacing
      const letterSpacing = 8; // Pixels between characters
      const text = displayName;
      let totalWidth = 0;
      
      // First measure total width with spacing
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const metrics = ctx.measureText(char);
        totalWidth += metrics.width + (i < text.length - 1 ? letterSpacing : 0);
      }
      
      // Now draw each character with spacing
      let x = canvas.width / 2 - totalWidth / 2;
      const y = canvas.height / 2;
      
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const metrics = ctx.measureText(char);
        const charWidth = metrics.width;
        
        ctx.fillText(char, x + charWidth / 2, y);
        x += charWidth + letterSpacing;
      }
      
      // Update texture
      this.nameTexture.needsUpdate = true
    }
  }
}