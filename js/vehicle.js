import { Wheel } from './wheel.js';
import { ReplayRecorder } from './replays.js';
import { TireParticles } from './particles.js';

class Vehicle {
  vehicle
  tuning

  wheelMeshes = []

  engineForce = 0
  vehicleSteering = 0
  breakingForce = 0
  footBrake = 0
  handBrake = 0

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
  rearLeftEngineForce = 0
  rearRightEngineForce = 0
  prevYawError = 0
  escTorqueCutSmoothed = 0
  escOuterRearBrakeSmoothed = 0
  escBrakeBL = 0
  escBrakeBR = 0
  stabilityActuation = null
  tcsWasActive = false
  escWasActive = false
  tcsLightOffTimeoutId = null
  escLightOffTimeoutId = null

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
    this.tcsIndicator = document.getElementById('tcs-indicator')
    this.escIndicator = document.getElementById('esc-indicator')

    // Initialize wheels array after adding wheels to vehicle
    this.wheels = this.wheelMeshes.map((mesh, index) => {
      const wheelInfo = this.vehicle.getWheelInfo(index);
      const radius = index < 2 ? wheelRadiusFront : wheelRadiusBack;
      return new Wheel(this.chassis.body.ammo, wheelInfo, radius, this.vehicle, index);
    });

    this.particles = new TireParticles(scene, this)

    // Initialize replay recorder and start recording immediately
    this.recorder = new ReplayRecorder()
    this.recorder.start()
    console.log('Vehicle: Auto-recording started on car load')
  }

  updateIndicatorOnActivation(indicator, enabled, activeNow, wasActiveProp, timeoutProp) {
    if (!indicator) return
    if (!enabled) {
      indicator.classList.remove('active')
      if (this[timeoutProp]) {
        clearTimeout(this[timeoutProp])
        this[timeoutProp] = null
      }
      this[wasActiveProp] = false
      return
    }
    if (activeNow && !this[wasActiveProp]) {
      indicator.classList.add('active')
      if (this[timeoutProp]) clearTimeout(this[timeoutProp])
      this[timeoutProp] = setTimeout(() => {
        indicator.classList.remove('active')
        this[timeoutProp] = null
      }, 2000)
    }

    this[wasActiveProp] = activeNow
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
    
    const dt = 1/60;  // Assuming 60fps, ideally get this from the physics world
    const frontBrake = this.footBrake
    const rearBrake = this.footBrake + this.handBrake
    this.wheels[this.FRONT_LEFT].update(dt, 0, frontBrake)
    this.wheels[this.FRONT_RIGHT].update(dt, 0, frontBrake)
    this.wheels[this.BACK_LEFT].update(dt, this.rearLeftEngineForce, rearBrake + this.escBrakeBL)
    this.wheels[this.BACK_RIGHT].update(dt, this.rearRightEngineForce, rearBrake + this.escBrakeBR)
    this.wheels[this.FRONT_LEFT].gui()

    this.applyStabilityControl(dt)
    this.updateIndicatorOnActivation(
      this.escIndicator,
      params.spinPrevention,
      vehicleParams.spinAssistActive,
      'escWasActive',
      'escLightOffTimeoutId'
    )

    let tm, p, q, i
    const n = this.vehicle.getNumWheels()
    for (i = 0; i < n; i++) {
      tm = this.vehicle.getWheelTransformWS(i)
      p = tm.getOrigin()
      q = tm.getRotation()
      this.wheelMeshes[i].position.set(p.x(), p.y(), p.z())
      this.wheelMeshes[i].quaternion.set(q.x(), q.y(), q.z(), q.w())
      this.wheelMeshes[i].rotateX(-(this.wheels[i].rotation - this.wheels[i].wheelInfo.m_rotation))
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

    this.particles.updateSmoke(dt)
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

    wheelInfo.set_m_frictionSlip(0)
    wheelInfo.set_m_rollInfluence(1)

    this.wheelMeshes.push(wheelMesh)
    this.scene.add(wheelMesh)
  }

  applyTractionControl() {
    if (!params.tractionControl || this.engineForce <= 0 || !this.wheels.length) {
      return false
    }

    const rearSlip = (
      Math.abs(this.wheels[this.BACK_LEFT].slipRatio) +
      Math.abs(this.wheels[this.BACK_RIGHT].slipRatio)
    ) * 0.5
    const slipOverLimit = Math.max(0, rearSlip - params.tcSlipLimit)
    const baseCut = Math.min(params.tcMaxCut, slipOverLimit * params.tcStrength)

    // Fade TC in with speed so launches aren't overly torque-limited.
    // Use rear contact-patch forward speed (m/s) as the best proxy for "vehicle moving".
    const rearSpeedMps = Math.abs(
      (this.wheels[this.BACK_LEFT].forwardSpeed + this.wheels[this.BACK_RIGHT].forwardSpeed) * 0.5
    )
    const tcFullEffectMps = 20 * 0.44704
    const speedFactor = Math.min(1, rearSpeedMps / tcFullEffectMps)
    const cut = baseCut * speedFactor

    this.engineForce *= 1 - cut
    return cut > 0
  }

  applyStabilityActuation() {
    this.rearLeftEngineForce = this.engineForce
    this.rearRightEngineForce = this.engineForce
    this.escBrakeBL = 0
    this.escBrakeBR = 0
    const actuation = this.stabilityActuation
    if (!params.spinPrevention || !actuation) return

    this.engineForce *= 1 - actuation.torqueCut
    this.rearLeftEngineForce = this.engineForce
    this.rearRightEngineForce = this.engineForce
    this.escBrakeBL = actuation.escBrakeBL
    this.escBrakeBR = actuation.escBrakeBR
  }

  getOversteer(dt) {
    const wheelbaseM = 2.6
    const delta = this.vehicleSteering
    const v = this.vehicle.getCurrentSpeedKmHour() / 3.6

    const vel = this.chassis.body.ammo.getLinearVelocity()
    const basis = this.chassis.body.ammo.getWorldTransform().getBasis()
    const fwd = new Ammo.btVector3(basis.getRow(0).z(), basis.getRow(1).z(), basis.getRow(2).z())
    const right = new Ammo.btVector3(basis.getRow(0).x(), basis.getRow(1).x(), basis.getRow(2).x())
    const vLong = vel.dot(fwd)
    const vLat = vel.dot(right)
    const bodyBeta = Math.atan2(Math.abs(vLat), Math.abs(vLong) + 0.5)
    const wheelBeta = (
      Math.abs(this.wheels[this.BACK_LEFT].slipAngle) +
      Math.abs(this.wheels[this.BACK_RIGHT].slipAngle)
    ) * 0.5
    const beta = Math.max(bodyBeta, wheelBeta)

    const rMeasured = this.chassis.body.ammo.getAngularVelocity().y()
    const rExpected = (v / wheelbaseM) * Math.tan(delta)
    const yawError = rMeasured - rExpected
    const yawErrorRate = (yawError - this.prevYawError) / Math.max(dt, 0.001)
    this.prevYawError = yawError

    const k1 = 0.55
    const k2 = 0.12
    const turnAligned = Math.abs(rExpected) > 0.02 && yawError * rExpected > 0
    const growingError = turnAligned && yawErrorRate * rExpected > 0
      ? Math.min(3, Math.max(0, Math.abs(yawErrorRate)))
      : 0
    const yawTerm = turnAligned ? Math.abs(yawError) + k2 * growingError : Math.abs(yawError) * 0.5
    const spinTerm = Math.max(0, Math.abs(rMeasured) - Math.abs(rExpected) - 0.12)
    const metric = yawTerm + k1 * beta + spinTerm

    return { metric, yawRate: rMeasured, yawRateTarget: rExpected, yawRateError: yawError, rExpected, rMeasured, v }
  }

  applyStabilityControl(dt) {
    vehicleParams.yawRate = 0
    vehicleParams.yawRateTarget = 0
    vehicleParams.yawRateError = 0
    vehicleParams.oversteerMetric = 0
    vehicleParams.oversteerZone = 'stable'
    vehicleParams.spinAssistActive = false
    vehicleParams.spinAssistCut = 0
    vehicleParams.escBrake = 0
    this.stabilityActuation = null

    if (!params.spinPrevention || !this.wheels.length) {
      this.prevYawError = 0
      this.escTorqueCutSmoothed = 0
      this.escOuterRearBrakeSmoothed = 0
      return
    }

    const minSpeedMps = 12 * 0.44704
    const oversteer = this.getOversteer(dt)
    if (oversteer.v < minSpeedMps) {
      this.prevYawError = 0
      this.escTorqueCutSmoothed = 0
      this.escOuterRearBrakeSmoothed = 0
      return
    }

    vehicleParams.yawRate = oversteer.yawRate
    vehicleParams.yawRateTarget = oversteer.yawRateTarget
    vehicleParams.yawRateError = oversteer.yawRateError
    vehicleParams.oversteerMetric = oversteer.metric

    const v = oversteer.v
    const rExpected = oversteer.rExpected
    const rMeasured = oversteer.rMeasured
    const oversteerMetric = oversteer.metric

    const gain = Math.max(0.01, params.spinAssist)
    const T1 = 0.12 / gain
    const T2 = 0.28 / gain
    const T3 = 0.5 / gain
    const fullSpeedMps = 45 * 0.44704
    const speedFactor = Math.min(1, Math.max(0, (v - minSpeedMps) / (fullSpeedMps - minSpeedMps)))

    let zone = 'stable'
    if (oversteerMetric >= T3) zone = 'critical'
    else if (oversteerMetric >= T2) zone = 'active'
    else if (oversteerMetric >= T1) zone = 'warning'

    const maxCut = 0.45
    let targetCut = 0
    if (oversteerMetric > T1) {
      targetCut = Math.min(maxCut, ((oversteerMetric - T1) / Math.max(0.001, T3 - T1)) * maxCut)
    }
    targetCut *= 0.5 + 0.5 * speedFactor

    const maxBrake = 30
    let targetBrake = 0
    if (oversteerMetric > T1) {
      targetBrake = Math.min(maxBrake, ((oversteerMetric - T1) / Math.max(0.001, T3 - T1)) * maxBrake)
    }
    targetBrake *= 0.5 + 0.5 * speedFactor

    const smoothRate = 6
    this.escTorqueCutSmoothed += (targetCut - this.escTorqueCutSmoothed) * Math.min(1, smoothRate * dt)
    this.escOuterRearBrakeSmoothed += (targetBrake - this.escOuterRearBrakeSmoothed) * Math.min(1, smoothRate * dt)
    const torqueCut = this.escTorqueCutSmoothed
    const outerRearBrake = this.escOuterRearBrakeSmoothed

    vehicleParams.oversteerZone = zone
    vehicleParams.spinAssistCut = torqueCut
    vehicleParams.escBrake = outerRearBrake
    vehicleParams.spinAssistActive = torqueCut > 0.02 || outerRearBrake > 1

    const actuation = { torqueCut, escBrakeBL: 0, escBrakeBR: 0 }
    if (outerRearBrake > 0) {
      const yawSign = Math.abs(rExpected) > 0.02 ? Math.sign(rExpected) : Math.sign(rMeasured)
      if (yawSign > 0) actuation.escBrakeBR = outerRearBrake
      else if (yawSign < 0) actuation.escBrakeBL = outerRearBrake
    }
    this.stabilityActuation = actuation
  }

  updateControls(inputs) {
    // The JS tire model handles all longitudinal and lateral grip, so Bullet
    // contributes no wheel friction of its own (suspension + raycast only).
    for (const wheel of this.wheels) {
      wheel.wheelInfo.set_m_frictionSlip(0)
    }

    // Apply forces based on input controls
    // Throttle drives the rear tires independently of the brake so you can
    // hold the foot brake and gas at the same time (burnout / left-foot braking).
    // The brake key doubles as reverse: it brakes while rolling forward, then
    // drives backwards once the car has (nearly) stopped.
    const rollingForward = this.wheels.length && this.wheels[this.BACK_LEFT].forwardSpeed > 0.5
    let reverseThrottle = 0
    let footBrakeInput = inputs.brake
    if (inputs.brake > 0 && !rollingForward) {
      reverseThrottle = -inputs.brake
      footBrakeInput = 0
    }

    const throttleInput = inputs.throttle + reverseThrottle
    this.engineForce = this.maxEngineForce * throttleInput;
    this.applyStabilityActuation()
    const tcsActive = this.applyTractionControl()
    vehicleParams.curThrottle = this.maxEngineForce > 0 ? this.engineForce / this.maxEngineForce : 0
    this.updateIndicatorOnActivation(this.tcsIndicator, params.tractionControl, tcsActive, 'tcsWasActive', 'tcsLightOffTimeoutId')
    
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

    // Brakes are applied as brake torque inside the JS wheel model. Foot brake
    // hits all four wheels; handbrake adds extra torque to the rears only.
    this.footBrake = footBrakeInput * 100;
    this.handBrake = inputs.handbrake * 100;

    // Bullet only provides steering geometry now; drive and brake are JS-side.
    this.vehicle.applyEngineForce(0, this.BACK_LEFT);
    this.vehicle.applyEngineForce(0, this.BACK_RIGHT);

    this.vehicle.setSteeringValue(this.vehicleSteering, this.FRONT_LEFT);
    this.vehicle.setSteeringValue(this.vehicleSteering, this.FRONT_RIGHT);

    this.vehicle.setBrake(0, this.FRONT_LEFT);
    this.vehicle.setBrake(0, this.FRONT_RIGHT);
    this.vehicle.setBrake(0, this.BACK_LEFT);
    this.vehicle.setBrake(0, this.BACK_RIGHT);
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
    this.particles.updateTireMarks()
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

export { Vehicle, RemoteCar };