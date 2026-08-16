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
  constructor({ numGears, redline, topSpeedMph, driveWheelRadius }) {
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
    this.shiftFromRatio = 0
    this.shiftToRatio = 0

    this.gearRatios = createGearRatios(numGears, redline, topSpeedMph, driveWheelRadius)
    this.topGearRatio = this.gearRatios[this.gearRatios.length - 1]
    this.shiftPointsMph = this.gearRatios
      .slice(0, -1)
      .map(ratio => topSpeedMph * this.topGearRatio / ratio)
  }

  getDrivenWheelRpm(wheels, drivenWheelIndices) {
    const totalAngularVelocity = drivenWheelIndices.reduce(
      (total, index) => total + Math.abs(wheels[index].angularVelocity),
      0,
    )
    return totalAngularVelocity / drivenWheelIndices.length * RADIANS_PER_SECOND_TO_RPM
  }

  getDisplayRatio() {
    if (!this.shiftTimeout) return this.gearRatios[this.gear - 1]
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

  getDesiredGear(speedMph) {
    if (this.gear < this.numGears && speedMph >= this.shiftPointsMph[this.gear - 1]) {
      return this.gear + 1
    }
    if (this.gear > 1 && speedMph < this.shiftPointsMph[this.gear - 2] * 0.7) {
      return this.gear - 1
    }
    return this.gear
  }

  updateGear(speedMph) {
    if (this.shiftTimeout) return

    const desiredGear = this.getDesiredGear(speedMph)
    if (desiredGear === this.gear) return

    this.shiftFromRatio = this.gearRatios[this.gear - 1]
    this.shiftToRatio = this.gearRatios[desiredGear - 1]
    this.targetGear = desiredGear
    this.gear = desiredGear
    this.activeShiftDuration = params.shiftDuration
    this.shiftStartedAt = performance.now()
    this.shiftTimeout = setTimeout(() => {
      this.shiftTimeout = null
    }, this.activeShiftDuration * 1000)
  }

  getTorqueFactor() {
    return this.shiftTimeout ? params.shiftTorqueFactor : 1
  }

  update(speedMph, wheels, drivenWheelIndices) {
    this.updateGear(speedMph)
    this.updateDisplayedRpm(speedMph, wheels, drivenWheelIndices)
    return { torqueFactor: this.getTorqueFactor() }
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
