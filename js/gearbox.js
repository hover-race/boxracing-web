const RPM_TO_RADIANS_PER_SECOND = 2 * Math.PI / 60
const RADIANS_PER_SECOND_TO_RPM = 1 / RPM_TO_RADIANS_PER_SECOND

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function smoothstep(value) {
  return value * value * (3 - 2 * value)
}

function createGearRatios(numGears, redline, topSpeedMph, driveWheelRadius) {
  // Top gear reaches redline at topSpeedMph. Lower gears are geometrically spaced.
  const topSpeedMps = topSpeedMph * 0.44704
  const topGearWheelRpm = topSpeedMps / (2 * Math.PI * driveWheelRadius) * 60
  const topGearRatio = redline / topGearWheelRpm

  return Array.from({ length: numGears }, (_, index) => {
    if (numGears === 1) return topGearRatio
    const gear = index + 1
    const progression = numGears ** ((numGears - gear) / (numGears - 1))
    return topGearRatio * progression
  })
}

class Gearbox {
  constructor({ numGears, redline, topSpeedMph, driveWheelRadius, maxEngineForce, engineTorque }) {
    this.numGears = numGears
    this.redline = redline
    this.maxEngineForce = maxEngineForce
    this.maxEngineTorque = engineTorque
    this.idleRpm = 800
    this.engineTorque = 0
    this.engineFrictionTorque = 0
    this.converterTorque = 0
    this.netEngineTorque = 0
    this.engineRpm = this.idleRpm
    this.gear = 1
    this.targetGear = 1
    this.activeShiftDuration = params.shiftDuration
    this.shiftStartedAt = 0
    this.shiftTimeout = null
    this.shiftFromRatio = 0
    this.shiftToRatio = 0

    this.gearRatios = createGearRatios(numGears, redline, topSpeedMph, driveWheelRadius)
  }

  // Wheel speed and the ratio currently connecting wheels to engine.
  getDrivenWheelRpm(wheels, drivenWheelIndices) {
    const totalAngularVelocity = drivenWheelIndices.reduce(
      (total, index) => total + Math.abs(wheels[index].angularVelocity),
      0,
    )
    return totalAngularVelocity / drivenWheelIndices.length * RADIANS_PER_SECOND_TO_RPM
  }

  getTransmissionRpm(wheels, drivenWheelIndices, ratio = this.getCurrentRatio()) {
    return this.getDrivenWheelRpm(wheels, drivenWheelIndices) * ratio
  }

  getTransmissionRpmInGear(wheels, drivenWheelIndices, gear) {
    return this.getTransmissionRpm(wheels, drivenWheelIndices, this.gearRatios[gear - 1])
  }

  getShiftProgress() {
    if (!this.shiftTimeout) return 1
    return Math.min(1, (performance.now() - this.shiftStartedAt) / (this.activeShiftDuration * 1000))
  }

  getCurrentRatio() {
    if (!this.shiftTimeout) return this.gearRatios[this.gear - 1]
    const progress = this.getShiftProgress()
    return this.shiftFromRatio + (this.shiftToRatio - this.shiftFromRatio) * progress
  }

  getStallRpm() {
    return Math.max(this.idleRpm + 1, this.redline * params.converterStallRatio)
  }

  // Engine torque model.
  calculateEngineTorque(throttle) {
    // The assumed flat torque curve is cut completely at redline.
    return this.engineRpm < this.redline ? throttle * this.maxEngineTorque : 0
  }

  calculateEngineFrictionTorque(engineOmega) {
    // Constant friction dominates near idle; viscous friction grows with RPM.
    return params.engineFrictionNm + params.engineViscousFriction * engineOmega
  }

  calculateConverterTorque(engineOmega, transmissionOmega, transmissionRpm) {
    // Converter load is proportional to slip between engine and transmission.
    const slipOmega = engineOmega - transmissionOmega
    const stallOmega = this.getStallRpm() * RPM_TO_RADIANS_PER_SECOND
    const coupling = this.maxEngineTorque / stallOmega

    // Coupling increases with road speed and during a shift, pulling engine RPM
    // toward the interpolated transmission RPM.
    const speed = clamp(transmissionRpm / this.redline, 0, 1)
    const lockup = 1 + 4 * speed
    const shiftLoad = this.shiftTimeout ? params.shiftLoadMultiplier : 1
    const maxTorque = this.maxEngineTorque * 2

    return clamp(slipOmega * coupling * lockup * shiftLoad, -maxTorque, maxTorque)
  }

  updateEngineRpm(dt, engineForce, wheels, drivenWheelIndices) {
    const throttle = clamp(Math.abs(engineForce / this.maxEngineForce), 0, 1)
    const transmissionRpm = this.getTransmissionRpm(wheels, drivenWheelIndices)
    const engineOmega = this.engineRpm * RPM_TO_RADIANS_PER_SECOND
    const transmissionOmega = transmissionRpm * RPM_TO_RADIANS_PER_SECOND

    // Torque balance at the crankshaft:
    // combustion adds torque; friction and drivetrain load remove it.
    this.engineTorque = this.calculateEngineTorque(throttle)
    this.engineFrictionTorque = this.calculateEngineFrictionTorque(engineOmega)
    this.converterTorque =
      this.calculateConverterTorque(engineOmega, transmissionOmega, transmissionRpm)
    this.netEngineTorque =
      this.engineTorque
      - this.engineFrictionTorque
      - this.converterTorque

    // Torque changes angular velocity according to the configured engine inertia.
    const nextOmega = engineOmega + this.netEngineTorque / params.drivetrainEngineInertia * dt
    this.engineRpm = clamp(
      nextOmega * RADIANS_PER_SECOND_TO_RPM,
      this.idleRpm,
      this.redline,
    )
  }

  // Automatic shift selection and ratio transition.
  getDesiredGear(wheels, drivenWheelIndices) {
    if (this.engineRpm >= this.redline * 0.995 && this.gear < this.numGears) {
      return this.gear + 1
    }
    if (this.gear > 1) {
      const lowerGearRpm =
        this.getTransmissionRpmInGear(wheels, drivenWheelIndices, this.gear - 1)
      if (lowerGearRpm < this.redline * 0.7) return this.gear - 1
    }
    return this.gear
  }

  updateGear(wheels, drivenWheelIndices) {
    if (this.shiftTimeout) return

    const desiredGear = this.getDesiredGear(wheels, drivenWheelIndices)
    if (desiredGear !== this.gear) {
      this.targetGear = desiredGear
      this.shiftFromRatio = this.gearRatios[this.gear - 1]
      this.shiftToRatio = this.gearRatios[this.targetGear - 1]
      this.activeShiftDuration = params.shiftDuration
      this.shiftStartedAt = performance.now()
      this.shiftTimeout = setTimeout(() => {
        this.gear = this.targetGear
        this.shiftTimeout = null
      }, this.activeShiftDuration * 1000)
    }
  }

  // Torque passed from the engine through the converter to the wheels.
  getTorqueFactor(wheels, drivenWheelIndices) {
    if (this.engineRpm >= this.redline && this.gear === this.numGears) return 0

    // Gradually engage drive between idle and converter stall speed.
    const rpmRange = this.getStallRpm() - this.idleRpm
    const engagement = clamp((this.engineRpm - this.idleRpm) / rpmRange, 0, 1)
    const smoothEngagement = smoothstep(engagement)

    // A slipping converter multiplies wheel torque by up to 2x. Multiplication
    // fades to 1x as transmission speed catches engine speed.
    const transmissionRpm = this.getTransmissionRpm(wheels, drivenWheelIndices)
    const speedRatio = clamp(transmissionRpm / this.engineRpm, 0, 1)
    const converterFactor = smoothEngagement * (2 - speedRatio)

    // During a shift, reduce delivered torque most strongly at the midpoint.
    if (!this.shiftTimeout) return converterFactor
    const progress = this.getShiftProgress()
    const shiftFactor = 0.2 + 0.8 * Math.abs(progress * 2 - 1)
    return converterFactor * shiftFactor
  }

  update(dt, engineForce, wheels, drivenWheelIndices) {
    this.updateEngineRpm(dt, engineForce, wheels, drivenWheelIndices)
    this.updateGear(wheels, drivenWheelIndices)
    return {
      gearRatio: this.getCurrentRatio(),
      torqueFactor: this.getTorqueFactor(wheels, drivenWheelIndices),
    }
  }

  reset() {
    clearTimeout(this.shiftTimeout)
    this.engineRpm = this.idleRpm
    this.gear = 1
    this.targetGear = 1
    this.shiftStartedAt = 0
    this.shiftTimeout = null
    this.shiftFromRatio = 0
    this.shiftToRatio = 0
  }
}

export { Gearbox }
