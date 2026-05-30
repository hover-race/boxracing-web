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

  getWheelAxleCS() {
    const axle = this.wheelInfo.get_m_wheelAxleCS
      ? this.wheelInfo.get_m_wheelAxleCS()
      : this.wheelInfo.m_wheelAxleCS
    return new Ammo.btVector3(axle.x(), axle.y(), axle.z())
  }

  getWheelDirectionCS() {
    const dir = this.wheelInfo.get_m_wheelDirectionCS
      ? this.wheelInfo.get_m_wheelDirectionCS()
      : this.wheelInfo.m_wheelDirectionCS
    return new Ammo.btVector3(dir.x(), dir.y(), dir.z())
  }

  chassisLocalToWorld(localVec) {
    const basis = this.vehicleRigidBody.getWorldTransform().getBasis()
    const lx = localVec.x()
    const ly = localVec.y()
    const lz = localVec.z()
    return new Ammo.btVector3(
      basis.getRow(0).x() * lx + basis.getRow(1).x() * ly + basis.getRow(2).x() * lz,
      basis.getRow(0).y() * lx + basis.getRow(1).y() * ly + basis.getRow(2).y() * lz,
      basis.getRow(0).z() * lx + basis.getRow(1).z() * ly + basis.getRow(2).z() * lz
    )
  }

  rotateVectorAroundAxis(vec, axis, angle) {
    const q = new Ammo.btQuaternion(axis, angle)
    const out = new Ammo.btVector3(vec.x(), vec.y(), vec.z())
    out.rotate(q)
    Ammo.destroy(q)
    return out
  }

  getWheelAxes() {
    const directionCS = this.getWheelDirectionCS()
    let axleCS = this.getWheelAxleCS()
    const steering = this.getSteeringAngle()
    if (Math.abs(steering) > 1e-6) {
      axleCS = this.rotateVectorAroundAxis(axleCS, directionCS, steering)
    }

    const directionWS = this.chassisLocalToWorld(directionCS)
    const sideWS = this.chassisLocalToWorld(axleCS)
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
    let driveTorque = Math.max(0, engineForce) / 3000 * params.engineTorque
    const slipOverLimit = Math.max(0, Math.abs(this.slipRatio) - params.tcSlipLimit)
    if (params.tractionControl && slipOverLimit > 0) {
      driveTorque *= Math.max(0, 1 - Math.min(params.tcMaxCut, slipOverLimit * params.tcStrength))
    }
    return driveTorque
  }

  getBrakeTorque(brakeForce) {
    if (brakeForce <= 0 || Math.abs(this.angularVelocity) < 0.01) return 0
    return -Math.sign(this.angularVelocity) * (brakeForce / 100) * params.brakeTorque
  }

  update(dt, engineForce, brakeForce) {
    this.forwardForceScalar = 0
    this.sideForceScalar = 0
    this.skidInfo = this.getSkidInfo()

    if (!this.isInContact()) {
      const torque = this.getDriveTorque(engineForce) + this.getBrakeTorque(brakeForce)
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

    this.slipRatio = this.calculateSlipRatio(forwardSpeed)
    this.slipAngle = Math.atan2(lateralSpeed, Math.abs(forwardSpeed) + 0.5)

    this.forwardSpeed = forwardSpeed

    const normalForce = this.getNormalForce()
    const maxForward = normalForce * params.gripForward
    const maxSide = normalForce * params.gripSide

    // Longitudinal: spring on slip ratio + damping on slip velocity
    const slipVelocity = this.angularVelocity * this.radius - forwardSpeed
    const longSpring = Math.tanh(this.slipRatio * params.tireLongitudinalStiffness) * maxForward
    const longDamping = slipVelocity * params.tireSlipDamping
    let forwardForce = longSpring + longDamping

    // Side: opposes slip along the steered axle (width of friction ellipse)
    let sideForce = -Math.tanh(lateralSpeed * params.tireLateralStiffness) * maxSide

    if (maxForward > 0 && maxSide > 0) {
      const ex = sideForce / maxSide
      const ey = forwardForce / maxForward
      const load = Math.sqrt(ex * ex + ey * ey)
      if (load > 1) {
        forwardForce /= load
        sideForce /= load
      }
    }

    this.applyTireForce(forwardDir, forwardForce, sideDir, sideForce)

    const tireTorque = -forwardForce * this.radius
    const driveTorque = this.getDriveTorque(engineForce)
    const brakeTorque = this.getBrakeTorque(brakeForce)
    this.torque = driveTorque + brakeTorque + tireTorque
    this.angularVelocity += this.torque / params.wheelInertia * dt
    this.angularVelocity = this.clamp(this.angularVelocity, -params.maxWheelAngularVelocity, params.maxWheelAngularVelocity)
    this.rotation += this.angularVelocity * dt
    this.isSlipping = Math.abs(this.slipRatio) >= params.smokeSlipThreshold
  }

  getSmokeIntensity() {
    if (!this.isSlipping) return 0

    const slipRange = 1 - params.smokeSlipThreshold
    return this.clamp((Math.abs(this.slipRatio) - params.smokeSlipThreshold) / slipRange, 0, 1)
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