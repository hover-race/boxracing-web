class Wheel {
  constructor(vehicleRigidBody, wheelInfo, radius, inertia = 1.0) {
    this.vehicleRigidBody = vehicleRigidBody
    this.wheelInfo = wheelInfo;
    this.radius = radius;
    this.inertia = inertia;  // Moment of inertia for the wheel
    this.extraRotation = 0;  // models wheel spin since ammo/bullet doesn't support it

    // State variables
    this.angularVelocity = 0;  // rad/s
    this.extraAngularVelocity = 0;
    this.rotation = 0;         // total rotation in radians
    this.torque = 0;          // Current torque applied to wheel
    this.brakeTorque = 0;     // Current braking torque
    this.slipRatio = 0;       // Current slip ratio
    this.skidInfo = 1;
    this.isSlipping = false;
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

  getForwardSpeed() {
    const forward = this.getVehicleForward()
    return this.vehicleRigidBody.getLinearVelocity().dot(forward)
  }

  calculateSlipRatio(angularVelocity = this.angularVelocity) {
    const forwardSpeed = this.getForwardSpeed()
    const surfaceSpeed = angularVelocity * this.radius
    const denominator = Math.max(Math.abs(surfaceSpeed), Math.abs(forwardSpeed), 1)
    return this.clamp((surfaceSpeed - forwardSpeed) / denominator, -1, 1)
  }

  updateExtraSpin(dt, engineForce, brakeForce) {
    let driveForce = Math.max(0, engineForce)
    const slipOverLimit = Math.max(0, Math.abs(this.slipRatio) - params.tcSlipLimit)
    if (params.tractionControl && slipOverLimit > 0) {
      driveForce *= Math.max(0, 1 - Math.min(params.tcMaxCut, slipOverLimit * params.tcStrength))
    }

    const brakeDrag = brakeForce * params.wheelBrakeDrag
    const angularAcceleration = (driveForce * params.wheelSpinTorqueScale - brakeDrag) / this.inertia
    this.extraAngularVelocity += angularAcceleration * dt

    const grip = this.isInContact() ? params.wheelSpinGrip : params.airWheelSpinGrip
    this.extraAngularVelocity += (0 - this.extraAngularVelocity) * Math.min(1, grip * dt)
    this.extraAngularVelocity = this.clamp(this.extraAngularVelocity, -params.maxExtraWheelAngularVelocity, params.maxExtraWheelAngularVelocity)
    this.extraRotation += this.extraAngularVelocity * dt
  }

  update(dt, engineForce, brakeForce) {
    const groundAngularVelocity = this.getGroundAngularVelocity(dt)
    this.skidInfo = this.getSkidInfo()
    this.updateExtraSpin(dt, engineForce, brakeForce)
    this.angularVelocity = groundAngularVelocity + this.extraAngularVelocity
    this.slipRatio = this.calculateSlipRatio()
    this.isSlipping = this.isInContact() && Math.abs(this.slipRatio) >= params.smokeSlipThreshold
  }

  getSmokeIntensity() {
    if (!this.isSlipping) return 0

    const slipRange = 1 - params.smokeSlipThreshold
    return this.clamp((Math.abs(this.slipRatio) - params.smokeSlipThreshold) / slipRange, 0, 1)
  }

  gui() {
    vehicleParams.slipRatio = this.slipRatio
    vehicleParams.rearLeftSlipRatio = this.slipRatio
    vehicleParams.isSlipping = this.isSlipping
    vehicleParams.skidInfo = this.skidInfo
    vehicleParams.wheelSpinVelocity = this.extraAngularVelocity
    vehicleParams.extraRotation = this.extraRotation
    vehicleParams.speed = this.vehicleRigidBody.getLinearVelocity().length()
  }
}

export { Wheel }; 