const CameraMode = Object.freeze({
  FOLLOW: 'follow',
  OVERHEAD: 'overhead',
  ORBIT: 'orbit',
  BUMPER: 'bumper',
  SIDE: 'side',
})

class CameraFollow {
  constructor() {
    // Configuration
    this.distance = 10.0;
    this.height = 5.0;
    this.viewHeightRatio = 0.5;
    this.lookBehind = false;
    this.heightDamping = 2.0;
    this.rotationDamping = 3.0;
    this.followVelocity = true;
    this.velocityDamping = 5.0;
    
    // Safety limits
    this.maxHeight = 100.0;
    this.minHeight = 0.1;

    // Internal state
    this.smoothLastPos = new THREE.Vector3();
    this.smoothVelocity = new THREE.Vector3();
    this.smoothTargetAngle = 0.0;
    this.selfRotationAngle = 0.0;
    this.selfHeight = 0.0;
  }

  reset(camera, target) {
    if (!target) return;

    this.smoothLastPos.copy(target.position);
    this.smoothVelocity.copy(target.getWorldDirection(new THREE.Vector3())).multiplyScalar(2.0);
    this.smoothTargetAngle = target.rotation.y;
    this.selfRotationAngle = camera.rotation.y;
    this.selfHeight = target.position.y + this.height; // Initialize at proper height
  }

  update(camera, target, deltaTime) {
    if (!target || !deltaTime || deltaTime <= 0 || isNaN(deltaTime)) {
      // Skip update if invalid parameters
      return;
    }

    // Clamp deltaTime to prevent large jumps
    const clampedDeltaTime = Math.min(deltaTime, 0.1);
    
    // Calculate velocity
    const currentPos = target.position.clone();
    const updatedVelocity = currentPos.sub(this.smoothLastPos).divideScalar(clampedDeltaTime);
    if (this.lookBehind) updatedVelocity.multiplyScalar(-1);
    this.smoothLastPos.copy(target.position);

    updatedVelocity.y = 0.0;

    // Update smooth velocity if moving
    if (updatedVelocity.length() > 1.0) {
      // Lerp velocity
      this.smoothVelocity.lerp(updatedVelocity, this.velocityDamping * clampedDeltaTime);
      this.smoothTargetAngle = Math.atan2(this.smoothVelocity.x, this.smoothVelocity.z);
    }

    if (!this.followVelocity) {
      this.smoothTargetAngle = target.rotation.y;
    }

    // Calculate desired height with safety bounds
    const wantedHeight = Math.min(this.maxHeight, Math.max(this.minHeight,
                                 target.position.y + this.height));

    // Smooth rotation and height with safety checks
    this.selfRotationAngle = this.lerpAngle(this.selfRotationAngle, this.smoothTargetAngle,
                                          this.rotationDamping * clampedDeltaTime);

    // Safe lerp for height
    const heightLerpFactor = Math.min(1.0, this.heightDamping * clampedDeltaTime);
    this.selfHeight = this.selfHeight * (1 - heightLerpFactor) + wantedHeight * heightLerpFactor;

    // Safety check for NaN or Infinity
    if (isNaN(this.selfHeight) || !isFinite(this.selfHeight)) {
      this.selfHeight = target.position.y + this.height;
    }

    // Calculate camera position
    const rotation = new THREE.Euler(0, this.selfRotationAngle, 0);
    const direction = new THREE.Vector3(0, 0, 1).applyEuler(rotation);

    const newPosition = target.position.clone()
      .sub(direction.multiplyScalar(this.distance));
    newPosition.y = this.selfHeight;

    // Final safety check for camera position
    if (isNaN(newPosition.x) || isNaN(newPosition.y) || isNaN(newPosition.z) ||
        !isFinite(newPosition.x) || !isFinite(newPosition.y) || !isFinite(newPosition.z)) {
      // Reset to safe position if invalid
      newPosition.set(
        target.position.x,
        target.position.y + this.height,
        target.position.z - this.distance
      );
    }

    // Update camera
    camera.position.copy(newPosition);

    // Look at target
    const lookAtPos = target.position.clone().add(new THREE.Vector3(0, this.height * this.viewHeightRatio, 0));
    camera.lookAt(lookAtPos);
  }

  // Utility function to interpolate angles
  lerpAngle(start, end, t) {
    let diff = end - start;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return start + diff * t;
  }
}

class CameraHelicopter {
  constructor() {
    this.height = 20
    this.distance = 25
    this.positionLerp = 0.02
    this.lookLerp = 0.04
    this._lookTarget = new THREE.Vector3()
  }

  initFromCamera(camera) {
    const dir = new THREE.Vector3()
    camera.getWorldDirection(dir)
    this._lookTarget.copy(camera.position).add(dir.multiplyScalar(20))
  }

  update(camera, target, deltaTime) {
    if (!target) return

    const tx = target.position.x
    const ty = target.position.y
    const tz = target.position.z

    const dx = tx - camera.position.x
    const dz = tz - camera.position.z
    const horizontalDist = Math.sqrt(dx * dx + dz * dz)

    let desiredX, desiredZ
    if (horizontalDist > 0.1) {
      const nx = dx / horizontalDist
      const nz = dz / horizontalDist
      desiredX = tx - nx * this.distance
      desiredZ = tz - nz * this.distance
    } else {
      desiredX = camera.position.x
      desiredZ = camera.position.z
    }
    const desiredY = ty + this.height

    camera.position.x += (desiredX - camera.position.x) * this.positionLerp
    camera.position.z += (desiredZ - camera.position.z) * this.positionLerp
    camera.position.y += (desiredY - camera.position.y) * this.positionLerp

    this._lookTarget.lerp(target.position, this.lookLerp)
    camera.lookAt(this._lookTarget)
  }
}

class CameraOrbit {
  constructor() {
    // Framing
    this.distance = 6
    this.minDistance = 2
    this.maxDistance = 30
    this.zoomSpeed = 1.5
    this.height = 0.5
    this.viewHeightRatio = 0.3
    this.heightDamping = 2.0
    // How far ahead of the car to look (in velocity direction)
    this.lookAheadDistance = 3.0

    // 45 degrees behind and to the side of the car's travel direction
    this.trailAngleOffset = Math.PI * 0.75  // 135 deg from forward = 45 deg behind-side
    // Very slow convergence so it lazily rotates into position
    this.rotationDamping = 0.4

    // Mouse drag sensitivity (radians per pixel)
    this.dragSensitivity = 0.005

    // Internal state
    this.currentAngle = 0
    this.selfHeight = 0
    this.smoothVelocity = new THREE.Vector3()
    this.smoothLastPos = new THREE.Vector3()
    this.velocityDamping = 3.0
    this._isDragging = false
    this._dragActive = false  // true while user is actively overriding the angle
    this._dragDecayTimer = 0  // time since last drag, controls convergence back

    this._setupMouseDrag()
  }

  _setupMouseDrag() {
    this._onMouseDown = (e) => {
      if (e.button === 0) {  // left click
        this._isDragging = true
        this._dragActive = true
        this._dragDecayTimer = 0
        this._lastMouseX = e.clientX
      }
    }
    this._onMouseMove = (e) => {
      if (!this._isDragging) return
      const dx = e.clientX - this._lastMouseX
      this._lastMouseX = e.clientX
      this.currentAngle += dx * this.dragSensitivity
      this._dragDecayTimer = 0
    }
    this._onMouseUp = (e) => {
      if (e.button === 0) {
        this._isDragging = false
      }
    }

    this._onWheel = (e) => {
      e.preventDefault()
      this.distance += e.deltaY * 0.01 * this.zoomSpeed
      this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance))
    }

    window.addEventListener('mousedown', this._onMouseDown)
    window.addEventListener('mousemove', this._onMouseMove)
    window.addEventListener('mouseup', this._onMouseUp)
    window.addEventListener('wheel', this._onWheel, { passive: false })
  }

  cleanup() {
    window.removeEventListener('mousedown', this._onMouseDown)
    window.removeEventListener('mousemove', this._onMouseMove)
    window.removeEventListener('mouseup', this._onMouseUp)
    window.removeEventListener('wheel', this._onWheel)
  }

  initFromCamera(camera, target) {
    if (target) {
      // Start from current camera angle relative to target
      const dx = camera.position.x - target.position.x
      const dz = camera.position.z - target.position.z
      this.currentAngle = Math.atan2(dx, dz)
      this.selfHeight = camera.position.y
      this.smoothLastPos.copy(target.position)
      this.smoothVelocity.set(0, 0, 0)
    }
  }

  lerpAngle(start, end, t) {
    let diff = end - start
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    return start + diff * t
  }

  update(camera, target, deltaTime) {
    if (!target || !deltaTime || deltaTime <= 0 || isNaN(deltaTime)) return

    const dt = Math.min(deltaTime, 0.1)

    // Calculate car's travel direction from velocity
    const currentPos = target.position.clone()
    const velocity = currentPos.clone().sub(this.smoothLastPos).divideScalar(dt)
    this.smoothLastPos.copy(target.position)
    velocity.y = 0

    // Smooth the velocity to avoid jitter; decay toward zero when slow
    if (velocity.length() > 0.5) {
      this.smoothVelocity.lerp(velocity, this.velocityDamping * dt)
    } else {
      this.smoothVelocity.multiplyScalar(1.0 - 2.0 * dt)  // decay to zero at rest
    }

    // While dragging, don't auto-converge; after release, ease back gradually
    if (!this._isDragging) {
      this._dragDecayTimer += dt
    }
    const dragFadeIn = this._dragActive ? Math.min(1.0, this._dragDecayTimer / 2.0) : 1.0
    if (this._dragDecayTimer > 3.0) {
      this._dragActive = false  // fully back to auto after 3 seconds
    }

    const isMoving = this.smoothVelocity.length() > 0.5

    if (isMoving) {
      // Converge to trailing angle behind the car's travel direction
      const travelAngle = Math.atan2(this.smoothVelocity.x, this.smoothVelocity.z)
      const desiredAngle = travelAngle + this.trailAngleOffset
      this.currentAngle = this.lerpAngle(this.currentAngle, desiredAngle, this.rotationDamping * dt * dragFadeIn)
    } else if (!this._isDragging) {
      // Gentle idle spin when stationary (0.05 rad/s, ~2 min per revolution)
      this.currentAngle += 0.05 * dt
    }

    // Smooth height tracking
    const wantedHeight = target.position.y + this.height
    const heightLerpFactor = Math.min(1.0, this.heightDamping * dt)
    this.selfHeight = this.selfHeight * (1 - heightLerpFactor) + wantedHeight * heightLerpFactor

    // Position camera at current angle around the target
    camera.position.set(
      target.position.x + Math.sin(this.currentAngle) * this.distance,
      this.selfHeight,
      target.position.z + Math.cos(this.currentAngle) * this.distance
    )

    // Look at a point ahead of the car in its travel direction
    const lookAtPos = target.position.clone()
      .add(new THREE.Vector3(0, this.height * this.viewHeightRatio, 0))
    if (this.smoothVelocity.length() > 0.5) {
      const ahead = this.smoothVelocity.clone().normalize().multiplyScalar(this.lookAheadDistance)
      lookAtPos.x += ahead.x
      lookAtPos.z += ahead.z
    }
    camera.lookAt(lookAtPos)
  }
}

// Camera attached to the car at a fixed local offset, looking in a fixed local direction
class CameraFixed {
  constructor(offset, lookAtOffset) {
    // Local-space offset from the car's position
    this.offset = offset.clone()
    // Local-space point to look at, relative to the car
    this.lookAtOffset = lookAtOffset.clone()
  }

  update(camera, target, deltaTime) {
    if (!target) return

    // Convert local offset to world space using the car's quaternion
    const worldOffset = this.offset.clone().applyQuaternion(target.quaternion)
    camera.position.copy(target.position).add(worldOffset)

    const worldLookAt = this.lookAtOffset.clone().applyQuaternion(target.quaternion)
    camera.lookAt(target.position.clone().add(worldLookAt))
  }
}

class CameraSwitcher {
  constructor(scene) {
    this.scene = scene
    this.mode = CameraMode.FOLLOW
    this.follow = new CameraFollow()
    this.helicopter = new CameraHelicopter()
    this.orbit = new CameraOrbit()
    // Bumper cam: low on the front of the car, looking forward
    this.bumper = new CameraFixed(
      new THREE.Vector3(0, 0.4, 1.2),     // front of car, just above bumper
      new THREE.Vector3(0, 0.3, 10)        // look far ahead
    )
    // Side cam: low to the right side, looking at the car
    this.side = new CameraFixed(
      new THREE.Vector3(2.5, 0.4, 0),      // right side, low
      new THREE.Vector3(0, 0.3, 2)          // look slightly ahead of car center
    )
    this.createUI()
  }

  initFollow(camera, target) {
    this.follow.reset(camera, target)
    this.follow.distance = 2.75
    this.follow.height = 1.3
    this.follow.heightDamping = 2.0
    this.follow.rotationDamping = 0.60
    this.follow.followVelocity = true
    this.follow.velocityDamping = 2.0
  }

  createUI() {
    // Ordered list of modes for cycling with C key
    this.modes = [CameraMode.FOLLOW, CameraMode.OVERHEAD, CameraMode.ORBIT, CameraMode.BUMPER, CameraMode.SIDE]
    this.modeLabels = {
      [CameraMode.FOLLOW]: 'Follow Cam',
      [CameraMode.OVERHEAD]: 'Overhead Cam',
      [CameraMode.ORBIT]: 'Orbit Cam',
      [CameraMode.BUMPER]: 'Bumper Cam',
      [CameraMode.SIDE]: 'Side Cam',
    }

    this.panel = document.createElement('div')
    this.panel.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 1000;
    `

    this.select = document.createElement('select')
    this.select.style.cssText = `
      padding: 8px 16px;
      border: 1px solid #666;
      border-radius: 6px;
      color: #fff;
      font-family: monospace;
      font-size: 14px;
      cursor: pointer;
      background: rgba(0, 0, 0, 0.7);
      outline: none;
      appearance: auto;
    `

    for (const mode of this.modes) {
      const option = document.createElement('option')
      option.value = mode
      option.textContent = this.modeLabels[mode]
      option.style.cssText = 'background: #222; color: #fff;'
      this.select.appendChild(option)
    }

    this.select.value = this.mode
    this.select.onchange = () => this.setMode(this.select.value)

    this.panel.appendChild(this.select)
    document.body.appendChild(this.panel)

    // Cycle camera modes on C key
    this._onKeyDown = (e) => {
      if (e.code === 'KeyC' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const currentIndex = this.modes.indexOf(this.mode)
        const nextIndex = (currentIndex + 1) % this.modes.length
        this.setMode(this.modes[nextIndex])
      }
    }
    window.addEventListener('keydown', this._onKeyDown)
  }

  setMode(mode) {
    this.mode = mode
    if (mode === CameraMode.OVERHEAD) {
      this.helicopter.initFromCamera(this.scene.camera)
    }
    if (mode === CameraMode.ORBIT) {
      this.orbit.initFromCamera(this.scene.camera, this._lastTarget)
    }

    // Keep dropdown in sync
    if (this.select) {
      this.select.value = mode
    }
  }

  update(camera, target, deltaTime) {
    if (!target) return
    this._lastTarget = target

    if (this.mode === CameraMode.OVERHEAD) {
      this.helicopter.update(camera, target, deltaTime)
    } else if (this.mode === CameraMode.ORBIT) {
      this.orbit.update(camera, target, deltaTime)
    } else if (this.mode === CameraMode.BUMPER) {
      this.bumper.update(camera, target, deltaTime)
    } else if (this.mode === CameraMode.SIDE) {
      this.side.update(camera, target, deltaTime)
    } else {
      this.follow.update(camera, target, deltaTime)
    }
  }
}

export { CameraMode, CameraFollow, CameraHelicopter, CameraOrbit, CameraFixed, CameraSwitcher };
