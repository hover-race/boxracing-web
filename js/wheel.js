class Wheel {
  constructor(vehicleRigidBody, wheelInfo, radius, inertia = 1.0) {
    this.vehicleRigidBody = vehicleRigidBody
    this.wheelInfo = wheelInfo;
    this.radius = radius;
    this.inertia = inertia;  // Moment of inertia for the wheel
    this.extraRotation = 0;  // models wheel spin since ammo/bullet doesn't support it

    // State variables
    this.angularVelocity = 0;  // rad/s
    this.rotation = 0;         // total rotation in radians
    this.torque = 0;          // Current torque applied to wheel
    this.brakeTorque = 0;     // Current braking torque
    this.slipRatio = 0;       // Current slip ratio
    this.debugForce = { x: 0, y: 0, z: 0 }; // Debug force components
    this.previousForce = { x: 0, y: 0, z: 0 }; // Previous frame's force
    
    // Friction properties
    this.friction = {
      maxForce: 2000,         // Maximum friction force in N
      forwardForceCurve: [    // Slip ratio to normalized force
        [0, 0],
        [0.2, 1],
        [0.4, 0.8],
        [1, 0.6],
      ],
      sideForceCurve: [
        [0, 0],
        [2, 0.5],
        [4, 0.75],
        [6, 0.8],
        [20, 0.6],
      ]
    };
  }

  linearInterpolation(curve, x) {
    const index = curve.findIndex(p => p[0] >= x);
    if (index === -1) return curve[curve.length - 1][1];
    if (index === 0) return curve[0][1];
    const [x1, y1] = curve[index - 1];
    const [x2, y2] = curve[index];
    const t = (x - x1) / (x2 - x1);
    return y1 + t * (y2 - y1);
  }

  getForwardForce(slipRatio) {
    const normalizedForce = this.linearInterpolation(this.friction.forwardForceCurve, Math.abs(slipRatio));
    // Add force clamping to prevent extreme oscillations
    // const maxForce = this.friction.maxForce;
    const maxForce = params.asdf;
    const rawForce = Math.sign(slipRatio) * normalizedForce * maxForce;
    return Math.max(-maxForce, Math.min(maxForce, rawForce));
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
 
  calculateSlipRatio() {
    // Slip ratio = (wheelCircumferentialVel / forwardVel) - 1
    const forward = this.getVehicleForward()
    var forwardVelocity = this.vehicleRigidBody.getLinearVelocity().dot(forward);
    // prevent division by zero
    const wheelVelocity = this.angularVelocity * this.radius;
    var slipRatio = (wheelVelocity - forwardVelocity) / (Math.abs(wheelVelocity) + Math.abs(forwardVelocity) + 0.01);

    vehicleParams.slipRatio = slipRatio;
    // clamp to -1 to 1
    return Math.max(-1, Math.min(1, slipRatio));
  }

  applyDebugForce() {
    const forceDir = new Ammo.btVector3(
      vehicleParams.forceDirX,
      vehicleParams.forceDirY,
      vehicleParams.forceDirZ
    );

    const contactPoint = this.wheelInfo.m_raycastInfo.m_contactPointWS
    const chassisPos = this.vehicleRigidBody.getWorldTransform().getOrigin()
    const relativePos = new Ammo.btVector3(
      contactPoint.x() - chassisPos.x(),
      contactPoint.y() - chassisPos.y(),
      contactPoint.z() - chassisPos.z()
    );
    // console.log([forceDir.x(), forceDir.y(), forceDir.z()], [relativePos.x(), relativePos.y(), relativePos.z()])
    this.vehicleRigidBody.applyForce(forceDir, relativePos)
  }

  crossProduct(vecA, vecB) {
    return new Ammo.btVector3(
        vecA.y() * vecB.z() - vecA.z() * vecB.y(),
        vecA.z() * vecB.x() - vecA.x() * vecB.z(),
        vecA.x() * vecB.y() - vecA.y() * vecB.x()
    );
  }

  angleDegrees(vecA, vecB) {
    return Math.acos(vecA.dot(vecB) / (vecA.length() * vecB.length())) * 180 / Math.PI
  }

  updateDeltaRotation(dt, engineForce, brakeForce, inputs) {
    // this.angularVelocity is a tweak of this.wheelInfo.m_deltaRotation.
    // this allows spinning wheels faster than the ground which bullet doesn't support.

    // First, read updates from external forces
    this.angularVelocity = this.wheelInfo.m_deltaRotation

    const MAX_ANGULAR_VELOCITY = 1000
    const DAMPING = 1
    const angularAcceleration = (engineForce - brakeForce) / this.inertia;
    this.angularVelocity += angularAcceleration * dt;
    if (engineForce === 0 && brakeForce === 0) {
      this.angularVelocity *= DAMPING;
    }
    this.angularVelocity = Math.max(-MAX_ANGULAR_VELOCITY, Math.min(MAX_ANGULAR_VELOCITY, this.angularVelocity));
    this.wheelInfo.m_deltaRotation = this.angularVelocity; // TODO * dt?
    this.wheelInfo.m_rotation += this.wheelInfo.m_deltaRotation;
  }

  getWheelForwardDirection() {
    return this.crossProduct(this.wheelInfo.m_raycastInfo.m_wheelAxleWS, this.wheelInfo.m_raycastInfo.m_wheelDirectionWS)
  }

  applyForces(forwardForceScalar, sidewaysForceScalar) {
    if (!this.wheelInfo.m_raycastInfo.m_isInContact) return

    const contactPoint = this.wheelInfo.m_raycastInfo.m_contactPointWS
    const chassisPos = this.vehicleRigidBody.getWorldTransform().getOrigin()
    const relativePos = new Ammo.btVector3(
      contactPoint.x() - chassisPos.x(),
      contactPoint.y() - chassisPos.y(),
      contactPoint.z() - chassisPos.z()
    );

    const forceDir = this.getWheelForwardDirection()
    const force = forceDir.op_mul(forwardForceScalar)
    vehicleParams.forceDirX = force.x()
    vehicleParams.forceDirY = force.y()
    vehicleParams.forceDirZ = force.z() 
    this.vehicleRigidBody.applyForce(force, relativePos)

    const sidewaysForceDir = this.wheelInfo.m_raycastInfo.m_wheelAxleWS
    const sidewaysForce = sidewaysForceDir.op_mul(sidewaysForceScalar)
    this.vehicleRigidBody.applyForce(sidewaysForce, relativePos)
  }

  slowDown(dt, slipRatio) {
    const FACTOR = 1
    // Slow down rotation if in contact.
    this.angularVelocity *= Math.abs(slipRatio) * FACTOR
    this.wheelInfo.m_deltaRotation = this.angularVelocity * dt;
  }

  pv(vec) {
    console.log([vec.x(), vec.y(), vec.z()])
  }

  signedAngleDeg(vecA, vecB) {
    // Calculate cross product once
    var cross = this.crossProduct(vecA, vecB)
    
    // Use up vector as reference for sign
    var up = new Ammo.btVector3(0, 1, 0)
    
    // Get dot product for angle magnitude
    var dot = vecA.dot(vecB)
    
    // Calculate angle
    var angle = Math.atan2(cross.length(), dot)
    
    // Determine sign based on direction of cross product relative to up vector
    var sign = cross.dot(up) >= 0 ? 1 : -1
    
    return sign * angle * 180 / Math.PI
  }

  calculateSlipAngle() {
    // the difference between the direction the tire is facing, and its velocity.
    // 1. need wheel forward direction
    var wheelForwardDirection = this.getWheelForwardDirection()
    var wheelVelocity = this.vehicleRigidBody.getLinearVelocity()
    var angleDegrees = this.signedAngleDeg(wheelForwardDirection, wheelVelocity)
    return angleDegrees
  } 

  getSidewaysForceScalar() {
    var slipAngle = this.calculateSlipAngle()
    vehicleParams.slipAngle = slipAngle

    var axleDirection = this.wheelInfo.m_raycastInfo.m_wheelAxleWS
    var sidewaysVelocity = this.vehicleRigidBody.getLinearVelocity().dot(axleDirection)
    const normalizedForce = this.linearInterpolation(this.friction.sideForceCurve, Math.abs(slipAngle));
    // Add force clamping to prevent extreme oscillations
  
    const maxForce = params.sideForceMultiplier
    const rawForce = Math.sign(slipAngle) * normalizedForce * maxForce * sidewaysVelocity;
    return Math.max(-maxForce, Math.min(maxForce, rawForce));
  }
  
  update(dt, engineForce, brakeForce, inputs) {
    this.updateSlipRatio(dt, inputs)

    const forwardForceScalar = this.getForwardForce(this.slipRatio)
    vehicleParams.forwardForceScalar = forwardForceScalar

    // this.applyForces(forwardForceScalar, 0)

    // this.slipRatio = this.calculateSlipRatio()
    return

    this.updateDeltaRotation(dt, engineForce, brakeForce)

    if (!this.wheelInfo.m_raycastInfo.m_isInContact) {
      return;
    }

    // this.slowDown(dt, slipRatio)

    var sideForceScalar = this.getSidewaysForceScalar()
    vehicleParams.sideForceScalar = sideForceScalar

    // this.applyForces(0, sideForceScalar)
  }

  calculateForwardForce() {
    const forwardForceScalar = this.getForwardForce(this.slipRatio)
    // this.applyForwardForce(forwardForceScalar)

    return forwardForceScalar
  }

  updateSlipRatio(dt, inputs) {
    // Default decay rate when no input
    const decayRate = 0.75;
    
    // Target angular velocity based on inputs
    const maxSlipRatio = 1; // Maximum slip ratio rate
    const maxBrakeSlipRatio = -1; // Maximum negative slip ratio when braking
    
    let targetSlipRatio = 0;
    if (inputs.throttle > 0) {
      targetSlipRatio = maxSlipRatio;
    } else if (inputs.brake) {
      targetSlipRatio = maxBrakeSlipRatio;
    }

    // Current vehicle speed
    const velocity = this.vehicleRigidBody.getLinearVelocity();
    const forward = this.getVehicleForward();
    const speed = velocity.dot(forward);
    const MAX_SPEED_KPH = 30;
    const speedFactor = Math.max(0, 1 - speed/MAX_SPEED_KPH); // Reduce effect at higher speeds

    // Smoothly interpolate between current and target slip ratio
    if (Math.abs(this.slipRatio - targetSlipRatio) > 0.01) {
      if (inputs.throttle || inputs.brake) {
        // Accelerate towards target when input pressed
        this.slipRatio = this.slipRatio * decayRate + targetSlipRatio * speedFactor * 0.1;
      } else {
        // Decay towards 0 when no input
        this.slipRatio *= decayRate;
      }
    }

  }

  gui() {
    vehicleParams.slipRatio = this.slipRatio
    vehicleParams.speed = this.vehicleRigidBody.getLinearVelocity().length()

  }
} 