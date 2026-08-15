class Gearbox {
  constructor({ numGears, redline, topSpeedMph, driveWheelRadius, maxEngineForce }) {
    this.numGears = numGears
    this.redline = redline
    this.maxEngineForce = maxEngineForce
    this.idleRpm = 800
    this.stallRpm = redline * 0.35
    this.engineRpm = this.idleRpm
    this.gear = 1
    this.targetGear = 1
    this.shiftDuration = 0.35
    this.shiftTimeRemaining = 0
    this.shiftInterval = null

    const topSpeedMps = topSpeedMph * 0.44704
    const topGearWheelRpm = topSpeedMps / (2 * Math.PI * driveWheelRadius) * 60
    const topGearRatio = redline / topGearWheelRpm
    this.gearRatios = Array.from({ length: numGears }, (_, index) => {
      if (numGears === 1) return topGearRatio
      const gear = index + 1
      const progression = numGears ** ((numGears - gear) / (numGears - 1))
      return topGearRatio * progression
    })
  }

  getDrivenWheelRpm(wheels, drivenWheelIndices) {
    const totalAngularVelocity = drivenWheelIndices.reduce(
      (total, index) => total + Math.abs(wheels[index].angularVelocity),
      0,
    )
    return totalAngularVelocity / drivenWheelIndices.length * 60 / (2 * Math.PI)
  }

  getTransmissionRpm(wheels, drivenWheelIndices, gear = this.gear) {
    return this.getDrivenWheelRpm(wheels, drivenWheelIndices) * this.gearRatios[gear - 1]
  }

  updateEngineRpm(dt, engineForce, wheels, drivenWheelIndices) {
    const throttle = Math.min(1, Math.abs(engineForce / this.maxEngineForce))
    const transmissionRpm = this.getTransmissionRpm(wheels, drivenWheelIndices)
    const normalizedTransmissionRpm = Math.min(1, transmissionRpm / this.redline)
    const converterSlipRpm = throttle * this.stallRpm * (1 - normalizedTransmissionRpm)
    const targetRpm = Math.max(
      this.idleRpm,
      Math.min(this.redline, transmissionRpm + converterSlipRpm),
    )
    const response = targetRpm > this.engineRpm ? 5 : 12
    this.engineRpm += (targetRpm - this.engineRpm) * Math.min(1, response * dt)
  }

  getDesiredGear(wheels, drivenWheelIndices) {
    if (this.engineRpm >= this.redline * 0.995 && this.gear < this.numGears) {
      return this.gear + 1
    }
    if (this.gear > 1) {
      const lowerGearRpm = this.getTransmissionRpm(wheels, drivenWheelIndices, this.gear - 1)
      if (lowerGearRpm < this.redline * 0.7) return this.gear - 1
    }
    return this.gear
  }

  updateGear(wheels, drivenWheelIndices) {
    if (this.shiftInterval) return

    const desiredGear = this.getDesiredGear(wheels, drivenWheelIndices)
    if (desiredGear !== this.gear) {
      this.targetGear = desiredGear
      this.shiftTimeRemaining = this.shiftDuration
      const shiftStartedAt = performance.now()
      this.shiftInterval = setInterval(() => {
        const elapsed = (performance.now() - shiftStartedAt) / 1000
        this.shiftTimeRemaining = Math.max(0, this.shiftDuration - elapsed)
        if (this.shiftTimeRemaining <= this.shiftDuration / 2) {
          this.gear = this.targetGear
        }
        if (this.shiftTimeRemaining === 0) {
          clearInterval(this.shiftInterval)
          this.shiftInterval = null
        }
      }, 16)
    }
  }

  getTorqueFactor(wheels, drivenWheelIndices) {
    if (this.engineRpm >= this.redline && this.gear === this.numGears) return 0
    const rpmRange = this.stallRpm - this.idleRpm
    const engagement = Math.max(0, Math.min(1, (this.engineRpm - this.idleRpm) / rpmRange))
    const smoothEngagement = engagement * engagement * (3 - 2 * engagement)
    const transmissionRpm = this.getTransmissionRpm(wheels, drivenWheelIndices)
    const speedRatio = Math.max(0, Math.min(1, transmissionRpm / this.engineRpm))
    const converterFactor = smoothEngagement * (2 - speedRatio)
    if (this.shiftTimeRemaining <= 0) return converterFactor
    const progress = 1 - this.shiftTimeRemaining / this.shiftDuration
    const shiftFactor = 0.2 + 0.8 * Math.abs(progress * 2 - 1)
    return converterFactor * shiftFactor
  }

  update(dt, engineForce, wheels, drivenWheelIndices) {
    this.updateEngineRpm(dt, engineForce, wheels, drivenWheelIndices)
    this.updateGear(wheels, drivenWheelIndices)
    return {
      gearRatio: this.gearRatios[this.gear - 1],
      torqueFactor: this.getTorqueFactor(wheels, drivenWheelIndices),
    }
  }

  reset() {
    clearInterval(this.shiftInterval)
    this.engineRpm = this.idleRpm
    this.gear = 1
    this.targetGear = 1
    this.shiftTimeRemaining = 0
    this.shiftInterval = null
  }
}

export { Gearbox }
