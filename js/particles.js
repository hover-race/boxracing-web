class TireParticles {
  constructor(scene, vehicle) {
    this.scene = scene
    this.vehicle = vehicle

    this.decalMaterial = new THREE.MeshPhongMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    })

    this.decals = new THREE.Group()
    scene.add(this.decals)

    this.smokeMaterial = new THREE.SpriteMaterial({
      color: 0xcccccc,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    })
    this.smokeParticles = []

    // Contact speed (m/s) below which effects are off; full strength above taperEnd.
    this.motionMin = 0.5
    this.motionTaperEnd = 5.0
  }

  wheelMotionFactor(wheel) {
    const forward = Math.abs(wheel.forwardSpeed ?? 0)
    const surface = Math.abs(wheel.angularVelocity * wheel.radius)
    const speed = Math.max(forward, surface)
    if (speed <= this.motionMin) return 0
    if (speed >= this.motionTaperEnd) return 1
    return (speed - this.motionMin) / (this.motionTaperEnd - this.motionMin)
  }

  slipMagnitudeFactor(slip) {
    const s = Math.abs(slip)
    if (s <= params.smokeSlipThreshold) return 0
    const slipRange = 1 - params.smokeSlipThreshold
    return Math.min(1, (s - params.smokeSlipThreshold) / slipRange)
  }

  wheelSlipFactor(wheel) {
    const longFactor = this.slipMagnitudeFactor(wheel.slipRatio)
    const latSlip = Math.abs(wheel.lateralSpeed ?? 0) / Math.max(Math.abs(wheel.forwardSpeed ?? 0), 1)
    const latFactor = this.slipMagnitudeFactor(latSlip)
    return Math.max(longFactor, latFactor)
  }

  // Shared 0–1 intensity for smoke and decals: contact, slip taper, motion taper.
  wheelEffectIntensity(wheel) {
    if (!wheel.isInContact()) return 0
    return this.wheelSlipFactor(wheel) * this.wheelMotionFactor(wheel)
  }

  updateSmoke(dt) {
    if (params.smokeEnabled) {
      for (const wheel of this.vehicle.wheels) {
        this.emitSmoke(wheel, dt)
      }
    }

    for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
      const particle = this.smokeParticles[i]
      particle.userData.age += dt
      const progress = particle.userData.age / particle.userData.life
      if (progress >= 1) {
        this.removeSmokeParticle(i)
        continue
      }

      particle.position.addScaledVector(particle.userData.velocity, dt)
      particle.material.opacity = particle.userData.opacity * (1 - progress)
      const scale = particle.userData.startScale * (1 + progress * 2.5)
      particle.scale.set(scale, scale, scale)
    }

    while (this.smokeParticles.length > params.maxSmokeParticles) {
      this.removeSmokeParticle(0)
    }
  }

  emitSmoke(wheel, dt) {
    const intensity = this.wheelEffectIntensity(wheel)
    if (intensity <= 0) return

    wheel.smokeAccumulator += intensity * params.smokeRate * dt
    while (wheel.smokeAccumulator >= 1) {
      this.spawnSmokeParticle(wheel, intensity)
      wheel.smokeAccumulator -= 1
    }
  }

  spawnSmokeParticle(wheel, intensity) {
    const contactPoint = wheel.getContactPoint()
    const particle = new THREE.Sprite(this.smokeMaterial.clone())
    const size = 0.25 + intensity * 0.35 + Math.random() * 0.1
    const chassisVelocity = this.vehicle.chassis.body.ammo.getLinearVelocity()
    const jitterRadius = 0.12 + intensity * 0.12
    const shade = 0.55 + Math.random() * 0.25

    particle.position.set(
      contactPoint.x() + (Math.random() - 0.5) * jitterRadius,
      contactPoint.y() + 0.06 + Math.random() * 0.1,
      contactPoint.z() + (Math.random() - 0.5) * jitterRadius
    )
    particle.scale.set(size, size, size)
    particle.material.color.setRGB(shade, shade, shade)
    particle.material.rotation = Math.random() * Math.PI * 2
    particle.material.opacity = 0.16 + intensity * 0.25 + Math.random() * 0.08
    particle.userData = {
      age: 0,
      life: 0.65 + intensity * 0.8 + Math.random() * 0.25,
      opacity: particle.material.opacity,
      startScale: size,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * (0.45 + intensity * 0.35) + chassisVelocity.x() * 0.02,
        0.45 + Math.random() * 0.75,
        (Math.random() - 0.5) * (0.45 + intensity * 0.35) + chassisVelocity.z() * 0.02
      ),
    }

    this.scene.add(particle)
    this.smokeParticles.push(particle)
  }

  removeSmokeParticle(index) {
    const particle = this.smokeParticles[index]
    this.scene.remove(particle)
    particle.material.dispose()
    this.smokeParticles.splice(index, 1)
  }

  updateTireMarks() {
    for (const wheel of this.vehicle.wheels) {
      this.applyDecal(wheel)
    }
  }

  applyDecal(wheel) {
    const intensity = this.wheelEffectIntensity(wheel)
    if (intensity <= 0) return
    if (Math.random() > intensity) return

    const wheelInfo = wheel.wheelInfo
    const contactPoint = wheel.getContactPoint()
    const position = new THREE.Vector3(contactPoint.x(), contactPoint.y(), contactPoint.z())

    const chassisRotation = this.vehicle.chassis.quaternion
    const steeringAngle = wheelInfo.get_m_steering()
    const rotation = chassisRotation.clone()
    rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), steeringAngle))

    const wheelWidth = 0.45

    const decalGeometry = new THREE.PlaneGeometry(wheelWidth, 0.6)
    decalGeometry.rotateX(-Math.PI / 2)

    const speed = Math.abs(this.vehicle.vehicle.getCurrentSpeedKmHour())
    const lengthScale = Math.min(1 + speed * 0.01, 10)
    decalGeometry.scale(wheelWidth, lengthScale, 1)

    const decal = new THREE.Mesh(decalGeometry, this.decalMaterial.clone())
    decal.material.opacity = this.decalMaterial.opacity * intensity
    decal.position.copy(position)
    decal.position.y += 0.01

    decal.quaternion.copy(rotation)

    this.decals.add(decal)

    if (this.decals.children.length > 1000) {
      const oldDecal = this.decals.children[0]
      this.decals.remove(oldDecal)
      oldDecal.geometry.dispose()
      oldDecal.material.dispose()
    }
  }
}

export { TireParticles }
