import { Config } from './config.js'

class Wheel {
  constructor(vehicleRigidBody, wheelInfo, radius, raycastVehicle, wheelIndex) {
    this.vehicleRigidBody = vehicleRigidBody
    this.wheelInfo = wheelInfo;
    this.radius = radius;
    this.raycastVehicle = raycastVehicle
    this.wheelIndex = wheelIndex

    // State variables
    this.angularVelocity = 0;  // rad/s
    this.rotation = 0;         // total rotation in radians
    this.torque = 0;          // Current torque applied to wheel
    this.brakeTorque = 0;     // Current braking torque
    this.slipRatio = 0;       // Current slip ratio
    this.slipAngle = 0;       // Current slip angle (radians)
    this.forwardSpeed = 0;    // Contact-patch speed along wheel forward
    this.skidInfo = 1;
    this.isSlipping = false;
    this.forwardForceScalar = 0;
    this.sideForceScalar = 0;
    this.smokeAccumulator = 0;
    this.debugForce = { x: 0, y: 0, z: 0 }; // Debug force components
    this.previousForce = { x: 0, y: 0, z: 0 }; // Previous frame's force
  }

  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
  }

  crossProduct(vecA, vecB) {
    return new Ammo.btVector3(
      vecA.y() * vecB.z() - vecA.z() * vecB.y(),
      vecA.z() * vecB.x() - vecA.x() * vecB.z(),
      vecA.x() * vecB.y() - vecA.y() * vecB.x()
    )
  }
 
  getRaycastInfo() {
    return this.wheelInfo.get_m_raycastInfo ? this.wheelInfo.get_m_raycastInfo() : this.wheelInfo.m_raycastInfo
  }

  isInContact() {
    const raycastInfo = this.getRaycastInfo()
    return raycastInfo.get_m_isInContact ? raycastInfo.get_m_isInContact() : raycastInfo.m_isInContact
  }

  getContactPoint() {
    const raycastInfo = this.getRaycastInfo()
    return raycastInfo.get_m_contactPointWS ? raycastInfo.get_m_contactPointWS() : raycastInfo.m_contactPointWS
  }

  getSkidInfo() {
    return this.wheelInfo.get_m_skidInfo ? this.wheelInfo.get_m_skidInfo() : this.wheelInfo.m_skidInfo
  }

  getGroundAngularVelocity(dt) {
    return this.wheelInfo.m_deltaRotation / Math.max(dt, 0.0001)
  }

  getSteeringAngle() {
    return this.wheelInfo.get_m_steering
      ? this.wheelInfo.get_m_steering()
      : this.wheelInfo.m_steering
  }

  getWheelDirectionWS() {
    const raycastInfo = this.getRaycastInfo()
    const dir = raycastInfo.get_m_wheelDirectionWS ? raycastInfo.get_m_wheelDirectionWS() : raycastInfo.m_wheelDirectionWS
    return new Ammo.btVector3(dir.x(), dir.y(), dir.z())
  }

  // Derive the wheel's world-space axes from Bullet's wheel transform (the same
  // transform that orients the rendered wheel mesh), so forces match what is drawn.
  // Column 0 of that basis is the steered axle (roll-invariant). Forward follows
  // Bullet's own convention: up x right, with up = -suspensionDirection.
  getWheelAxes() {
    const basis = this.raycastVehicle.getWheelTransformWS(this.wheelIndex).getBasis()
    const sideWS = new Ammo.btVector3(basis.getRow(0).x(), basis.getRow(1).x(), basis.getRow(2).x())

    const directionWS = this.getWheelDirectionWS()
    const forwardWS = this.crossProduct(sideWS, directionWS)

    return { forwardWS, sideWS }
  }

  getWheelForwardDirection() {
    return this.getWheelAxes().forwardWS
  }

  getContactRelativePosition() {
    const contactPoint = this.getContactPoint()
    const chassisPos = this.vehicleRigidBody.getWorldTransform().getOrigin()
    return new Ammo.btVector3(
      contactPoint.x() - chassisPos.x(),
      contactPoint.y() - chassisPos.y(),
      contactPoint.z() - chassisPos.z()
    )
  }

  getContactPointVelocity() {
    const relativePos = this.getContactRelativePosition()
    const angularVelocity = this.vehicleRigidBody.getAngularVelocity()
    const linearVelocity = this.vehicleRigidBody.getLinearVelocity()
    const angularPointVelocity = this.crossProduct(angularVelocity, relativePos)
    return new Ammo.btVector3(
      linearVelocity.x() + angularPointVelocity.x(),
      linearVelocity.y() + angularPointVelocity.y(),
      linearVelocity.z() + angularPointVelocity.z()
    )
  }

  getContactForwardSpeed() {
    return this.getContactPointVelocity().dot(this.getWheelForwardDirection())
  }

  getWheelSideDirection() {
    return this.getWheelAxes().sideWS
  }

  getNormalForce() {
    return this.wheelInfo.get_m_wheelsSuspensionForce
      ? this.wheelInfo.get_m_wheelsSuspensionForce()
      : this.wheelInfo.m_wheelsSuspensionForce
  }

  applyTireForce(forwardDir, longForce, sideDir, latForce) {
    const force = new Ammo.btVector3(
      forwardDir.x() * longForce + sideDir.x() * latForce,
      forwardDir.y() * longForce + sideDir.y() * latForce,
      forwardDir.z() * longForce + sideDir.z() * latForce
    )
    this.vehicleRigidBody.applyForce(force, this.getContactRelativePosition())
    this.forwardForceScalar = longForce
    this.sideForceScalar = latForce
  }

  calculateSlipRatio(forwardSpeed) {
    const surfaceSpeed = this.angularVelocity * this.radius
    const denominator = Math.max(Math.abs(forwardSpeed), 1)
    return this.clamp((surfaceSpeed - forwardSpeed) / denominator, -1, 1)
  }

  getDriveTorque(engineForce) {
    let driveTorque = engineForce / 3000 * params.engineTorque
    const slipOverLimit = Math.max(0, Math.abs(this.slipRatio) - params.tcSlipLimit)
    if (params.tractionControl && slipOverLimit > 0) {
      driveTorque *= Math.max(0, 1 - Math.min(params.tcMaxCut, slipOverLimit * params.tcStrength))
    }
    return driveTorque
  }

  getBrakeTorque(footBrake, handBrake = 0) {
    const brakeForce = footBrake + handBrake * 4
    if (brakeForce <= 0 || (Math.abs(this.angularVelocity) < 0.01 && handBrake <= 0)) return 0
    return -Math.sign(this.angularVelocity) * (brakeForce / 100) * params.brakeTorque
  }

  applyHandbrakeLock(handBrake, dt) {
    if (handBrake <= 0 || !this.isInContact()) return
    const lock = Math.min(1, handBrake / 150)
    this.angularVelocity *= 1 - Math.min(1, lock * 35 * dt)
    if (lock >= 0.75) this.angularVelocity = 0
  }

  update(dt, engineForce, footBrake, handBrake = 0) {
    const brakeForce = footBrake + handBrake
    this.forwardForceScalar = 0
    this.sideForceScalar = 0
    this.skidInfo = this.getSkidInfo()

    if (!this.isInContact()) {
      const torque = this.getDriveTorque(engineForce) + this.getBrakeTorque(footBrake, handBrake)
      this.angularVelocity += torque / params.wheelInertia * dt
      this.angularVelocity = this.clamp(this.angularVelocity, -params.maxWheelAngularVelocity, params.maxWheelAngularVelocity)
      this.rotation += this.angularVelocity * dt
      this.slipRatio = 0
      this.slipAngle = 0
      this.forwardSpeed = 0
      this.isSlipping = false
      return
    }

    const pointVelocity = this.getContactPointVelocity()
    const forwardDir = this.getWheelForwardDirection()
    const sideDir = this.getWheelSideDirection()
    const forwardSpeed = pointVelocity.dot(forwardDir)
    const lateralSpeed = pointVelocity.dot(sideDir)

    this.fwdWSx = forwardDir.x()
    this.fwdWSy = forwardDir.y()
    this.fwdWSz = forwardDir.z()

    this.slipRatio = this.calculateSlipRatio(forwardSpeed)
    this.slipAngle = Math.atan2(lateralSpeed, Math.abs(forwardSpeed) + 0.5)

    this.forwardSpeed = forwardSpeed
    this.lateralSpeed = lateralSpeed

    const normalForce = this.getNormalForce()
    const maxForward = normalForce * Config.gripForward
    const maxSide = normalForce * Config.gripSide
    this.normalForce = normalForce
    this.maxSide = maxSide

    const driveTorque = this.getDriveTorque(engineForce)
    const brakeTorque = this.getBrakeTorque(footBrake, handBrake)
    const c = params.tireSlipDamping
    const r = this.radius
    const I = params.wheelInertia
    const fwdLimit = Math.abs(maxForward)

    // Longitudinal: a stiff coupling drives the wheel toward the rolling condition
    // (omega*r == forwardSpeed). Solve it implicitly so it is unconditionally stable
    // (an explicit step with this stiffness overshoots and bang-bangs at the grip
    // limit). If the required force exceeds the friction limit the tire is sliding,
    // so clamp the force and integrate the wheel spin explicitly under the net torque.
    let omegaNext =
      (this.angularVelocity + dt / I * (driveTorque + brakeTorque + c * r * forwardSpeed)) /
      (1 + dt * c * r * r / I)
    let forwardForce = c * (omegaNext * r - forwardSpeed)
    if (Math.abs(forwardForce) > fwdLimit) {
      forwardForce = this.clamp(forwardForce, -fwdLimit, fwdLimit)
      omegaNext = this.angularVelocity + dt / I * (driveTorque + brakeTorque - forwardForce * r)
    }
    this.angularVelocity = this.clamp(omegaNext, -params.maxWheelAngularVelocity, params.maxWheelAngularVelocity)
    this.applyHandbrakeLock(handBrake, dt)
    this.rotation += this.angularVelocity * dt

    // Side: opposes slip along the steered axle, bounded by the side grip ceiling.
    const sideLimit = Math.abs(maxSide)
    let sideForce = this.clamp(-Math.tanh(lateralSpeed * params.tireLateralStiffness) * maxSide, -sideLimit, sideLimit)

    if (fwdLimit > 0 && sideLimit > 0) {
      const ex = sideForce / sideLimit
      const ey = forwardForce / fwdLimit
      const load = Math.sqrt(ex * ex + ey * ey)
      if (load > 1) {
        forwardForce /= load
        sideForce /= load
      }
    }

    this.applyTireForce(forwardDir, forwardForce, sideDir, sideForce)
    this.torque = driveTorque + brakeTorque - forwardForce * r
    const latSlip = Math.abs(lateralSpeed) / Math.max(Math.abs(forwardSpeed), 1)
    this.isSlipping = Math.max(Math.abs(this.slipRatio), latSlip) >= params.smokeSlipThreshold

    if (this.wheelIndex === 2) {
      const basis = this.vehicleRigidBody.getWorldTransform().getBasis()
      const noseX = basis.getRow(0).z(), noseY = basis.getRow(1).z(), noseZ = basis.getRow(2).z()
      const fwdDotNose = forwardDir.x() * noseX + forwardDir.y() * noseY + forwardDir.z() * noseZ
      const velDotNose = pointVelocity.x() * noseX + pointVelocity.y() * noseY + pointVelocity.z() * noseZ
      window.__wheelLog = window.__wheelLog || []
      window.__wheelLog.push({
        engineForce: +engineForce.toFixed(1),
        driveTorque: +driveTorque.toFixed(1),
        omega: +this.angularVelocity.toFixed(2),
        surfaceSpeed: +(this.angularVelocity * r).toFixed(3),
        fwdSpeed: +forwardSpeed.toFixed(3),
        slipRatio: +this.slipRatio.toFixed(3),
        fwdForce: +forwardForce.toFixed(1),
        fwdDotNose: +fwdDotNose.toFixed(3),
        velDotNose: +velDotNose.toFixed(3),
      })
      if (window.__wheelLog.length > 60) window.__wheelLog.shift()
    }
  }

  gui() {
    vehicleParams.slipRatio = this.slipRatio
    vehicleParams.slipValue = Math.abs(this.slipRatio)
    vehicleParams.rearLeftSlipRatio = this.slipRatio
    vehicleParams.slipAngle = this.slipAngle * 180 / Math.PI
    vehicleParams.wheelSpeed = this.forwardSpeed
    vehicleParams.wheelSteerAngle = this.getSteeringAngle() * 180 / Math.PI
    vehicleParams.isSlipping = this.isSlipping
    vehicleParams.skidInfo = this.skidInfo
    vehicleParams.wheelSpinVelocity = this.angularVelocity
    vehicleParams.extraRotation = this.rotation
    vehicleParams.forwardForceScalar = this.forwardForceScalar
    vehicleParams.sideForceScalar = this.sideForceScalar
    vehicleParams.speed = this.vehicleRigidBody.getLinearVelocity().length()
  }
}

export { Wheel }; 