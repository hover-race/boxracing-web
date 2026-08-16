const RADIANS_PER_SECOND_TO_RPM = 60 / (2 * Math.PI)

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function createGearRatios(numGears, redline, topSpeedMph, driveWheelRadius) {
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
  constructor({ numGears, redline, topSpeedMph, driveWheelRadius, reverseGearRatio }) {
    this.numGears = numGears
    this.redline = redline
    this.topSpeedMph = topSpeedMph
    this.idleRpm = 800
    this.engineRpm = this.idleRpm
    this.gear = 1
    this.targetGear = 1
    this.activeShiftDuration = params.shiftDuration
    this.shiftStartedAt = 0
    this.shiftTimeout = null
    this.limiterTimeout = null
    this.shiftFromRatio = 0
    this.shiftToRatio = 0

    this.gearRatios = createGearRatios(numGears, redline, topSpeedMph, driveWheelRadius)
    this.reverseGearRatio = reverseGearRatio || this.gearRatios[0]
    this.topGearRatio = this.gearRatios[this.gearRatios.length - 1]
    this.shiftPointsMph = this.gearRatios
      .slice(0, -1)
      .map(ratio => topSpeedMph * this.topGearRatio / ratio)
    this.reverseTopSpeedMph = topSpeedMph * this.topGearRatio / this.reverseGearRatio
  }

  getDrivenWheelRpm(wheels, drivenWheelIndices) {
    const totalAngularVelocity = drivenWheelIndices.reduce(
      (total, index) => total + Math.abs(wheels[index].angularVelocity),
      0,
    )
    return totalAngularVelocity / drivenWheelIndices.length * RADIANS_PER_SECOND_TO_RPM
  }

  getRatioFor(gear) {
    if (gear < 0) return this.reverseGearRatio
    return this.gearRatios[gear - 1]
  }

  getGearLabel() {
    return this.gear < 0 ? 'R' : this.gear
  }

  getDisplayRatio() {
    if (!this.shiftTimeout) return this.getRatioFor(this.gear)
    const progress = Math.min(1, (performance.now() - this.shiftStartedAt) / (this.activeShiftDuration * 1000))
    return this.shiftFromRatio + (this.shiftToRatio - this.shiftFromRatio) * progress
  }

  updateDisplayedRpm(speedMph, wheels, drivenWheelIndices) {
    const ratio = this.getDisplayRatio()
    const wheelRpm = this.getDrivenWheelRpm(wheels, drivenWheelIndices) * ratio
    const roadRpm = speedMph / this.topSpeedMph * this.redline * (ratio / this.topGearRatio)
    const coupledRpm = wheelRpm + (roadRpm - wheelRpm) * params.rpmRoadCoupling
    this.engineRpm = clamp(coupledRpm, this.idleRpm, this.redline)
  }

  getDesiredGear(speedMph, reversing) {
    if (reversing) return -1
    if (this.gear < 0) return 1
    if (this.gear < this.numGears && speedMph >= this.shiftPointsMph[this.gear - 1]) {
      return this.gear + 1
    }
    if (this.gear > 1 && speedMph < this.shiftPointsMph[this.gear - 2] * 0.7) {
      return this.gear - 1
    }
    return this.gear
  }

  updateGear(speedMph, reversing) {
    if (this.shiftTimeout) return

    const desiredGear = this.getDesiredGear(speedMph, reversing)
    if (desiredGear === this.gear) return

    this.shiftFromRatio = this.getRatioFor(this.gear)
    this.shiftToRatio = this.getRatioFor(desiredGear)
    this.targetGear = desiredGear
    this.gear = desiredGear
    this.activeShiftDuration = params.shiftDuration
    this.shiftStartedAt = performance.now()
    this.shiftTimeout = setTimeout(() => {
      this.shiftTimeout = null
    }, this.activeShiftDuration * 1000)
  }

  cutLimiter() {
    if (this.limiterTimeout) return
    this.limiterTimeout = setTimeout(() => {
      this.limiterTimeout = null
    }, 200)
  }

  getTorqueFactor(speedMph) {
    if (this.limiterTimeout) return 0
    const atReverseLimit = this.gear < 0 && speedMph >= this.reverseTopSpeedMph
    const atRedline = this.engineRpm >= this.redline
    if (atReverseLimit || atRedline) {
      this.cutLimiter()
      return 0
    }
    return this.shiftTimeout ? params.shiftTorqueFactor : 1
  }

  update(speedMph, wheels, drivenWheelIndices, reversing) {
    this.updateGear(speedMph, reversing)
    this.updateDisplayedRpm(speedMph, wheels, drivenWheelIndices)
    return {
      gearRatio: this.getDisplayRatio(),
      torqueFactor: this.getTorqueFactor(speedMph),
    }
  }

  reset() {
    clearTimeout(this.shiftTimeout)
    clearTimeout(this.limiterTimeout)
    this.engineRpm = this.idleRpm
    this.gear = 1
    this.targetGear = 1
    this.shiftStartedAt = 0
    this.shiftTimeout = null
    this.limiterTimeout = null
    this.shiftFromRatio = 0
    this.shiftToRatio = 0
  }
}

export { Gearbox }
