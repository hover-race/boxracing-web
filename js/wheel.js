class Wheel {
  constructor(vehicleRigidBody, wheelInfo, radius) {
    this.vehicleRigidBody = vehicleRigidBody
    this.wheelInfo = wheelInfo;
    this.radius = radius;

    // State variables
    this.angularVelocity = 0;  // rad/s
    this.rotation = 0;         // total rotation in radians
    this.torque = 0;          // Current torque applied to wheel
    this.brakeTorque = 0;     // Current braking torque
    this.slipRatio = 0;       // Current slip ratio
    this.skidInfo = 1;
    this.isSlipping = false;
    this.forwardForceScalar = 0;
    this.smokeAccumulator = 0;
    this.debugForce = { x: 0, y: 0, z: 0 }; // Debug force components
    this.previousForce = { x: 0, y: 0, z: 0 }; // Previous frame's force
  }

  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
  }

  getVehicleForward() {
    const basis = this.vehicleRigidBody.getWorldTransform().getBasis();
    const forward = new Ammo.btVector3(
      basis.getRow(0).z(),
      basis.getRow(1).z(),
      basis.getRow(2).z() 
    )
    return forward
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

  getWheelForwardDirection() {
    const raycastInfo = this.getRaycastInfo()
    const axle = raycastInfo.get_m_wheelAxleWS ? raycastInfo.get_m_wheelAxleWS() : raycastInfo.m_wheelAxleWS
    const direction = raycastInfo.get_m_wheelDirectionWS ? raycastInfo.get_m_wheelDirectionWS() : raycastInfo.m_wheelDirectionWS
    const forward = this.crossProduct(axle, direction)
    const vehicleForward = this.getVehicleForward()
    if (forward.dot(vehicleForward) < 0) {
      return new Ammo.btVector3(-forward.x(), -forward.y(), -forward.z())
    }
    return forward
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

  getContactForwardSpeed() {
    const relativePos = this.getContactRelativePosition()
    const angularVelocity = this.vehicleRigidBody.getAngularVelocity()
    const linearVelocity = this.vehicleRigidBody.getLinearVelocity()
    const angularPointVelocity = this.crossProduct(angularVelocity, relativePos)
    const pointVelocity = new Ammo.btVector3(
      linearVelocity.x() + angularPointVelocity.x(),
      linearVelocity.y() + angularPointVelocity.y(),
      linearVelocity.z() + angularPointVelocity.z()
    )
    return pointVelocity.dot(this.getWheelForwardDirection())
  }

  getLongitudinalForce(forwardSpeed) {
    const slipVelocity = this.angularVelocity * this.radius - forwardSpeed
    const suspensionForce = this.wheelInfo.get_m_wheelsSuspensionForce
      ? this.wheelInfo.get_m_wheelsSuspensionForce()
      : this.wheelInfo.m_wheelsSuspensionForce
    const maxForce = suspensionForce * params.tireGrip
    const springForce = Math.tanh(this.slipRatio * params.tireLongitudinalStiffness) * maxForce
    const dampingForce = slipVelocity * params.tireSlipDamping
    return this.clamp(springForce + dampingForce, -maxForce, maxForce)
  }

  applyLongitudinalForce(forceScalar) {
    const forward = this.getWheelForwardDirection()
    const force = new Ammo.btVector3(
      forward.x() * forceScalar,
      forward.y() * forceScalar,
      forward.z() * forceScalar
    )
    this.vehicleRigidBody.applyForce(force, this.getContactRelativePosition())
    this.forwardForceScalar = forceScalar
    return forceScalar
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
    this.skidInfo = this.getSkidInfo()

    if (!this.isInContact()) {
      const torque = this.getDriveTorque(engineForce) + this.getBrakeTorque(brakeForce)
      this.angularVelocity += torque / params.wheelInertia * dt
      this.angularVelocity = this.clamp(this.angularVelocity, -params.maxWheelAngularVelocity, params.maxWheelAngularVelocity)
      this.rotation += this.angularVelocity * dt
      this.slipRatio = 0
      this.isSlipping = false
      return
    }

    const forwardSpeed = this.getContactForwardSpeed()
    this.slipRatio = this.calculateSlipRatio(forwardSpeed)

    const tireForce = this.getLongitudinalForce(forwardSpeed)
    this.applyLongitudinalForce(tireForce)

    const tireTorque = -tireForce * this.radius
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
    vehicleParams.isSlipping = this.isSlipping
    vehicleParams.skidInfo = this.skidInfo
    vehicleParams.wheelSpinVelocity = this.angularVelocity
    vehicleParams.extraRotation = this.rotation
    vehicleParams.forwardForceScalar = this.forwardForceScalar
    vehicleParams.speed = this.vehicleRigidBody.getLinearVelocity().length()
  }
}

export { Wheel }; 