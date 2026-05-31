
class CameraFollow {
  constructor() {
    this.label = 'Follow Cam'

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

  activate(camera, target) {
    if (!target) return;
    // Sync internal state from target so there's no snap on switch.
    this.smoothLastPos.copy(target.position);
    this.smoothVelocity.copy(target.getWorldDirection(new THREE.Vector3())).multiplyScalar(2.0);
    // Derive yaw from the car's forward vector — reliable regardless of camera state.
    const forward = target.getWorldDirection(new THREE.Vector3())
    this.smoothTargetAngle = Math.atan2(forward.x, forward.z)
    this.selfRotationAngle = this.smoothTargetAngle;
    this.selfHeight = target.position.y + this.height;
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
    this.label = 'Overhead Cam'
    this.height = 20
    this.distance = 25
    this.positionLerp = 0.02
    this.lookLerp = 0.04
    this._lookTarget = new THREE.Vector3()
  }

  activate(camera) {
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
    this.label = 'Orbit Cam'

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

    // Vertical orbit (pitch) range, in radians above the horizon
    this.currentElevation = 0.35
    this.minElevation = -0.2
    this.maxElevation = 1.4

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
        this._lastMouseY = e.clientY
      }
    }
    this._onMouseMove = (e) => {
      if (!this._isDragging) return
      const dx = e.clientX - this._lastMouseX
      const dy = e.clientY - this._lastMouseY
      this._lastMouseX = e.clientX
      this._lastMouseY = e.clientY
      this.currentAngle += dx * this.dragSensitivity
      // Drag up to raise the camera, down to lower it.
      this.currentElevation -= dy * this.dragSensitivity
      this.currentElevation = Math.max(this.minElevation, Math.min(this.maxElevation, this.currentElevation))
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

  activate(camera, target) {
    if (!target) return
    // Start from current camera angle relative to target
    const dx = camera.position.x - target.position.x
    const dz = camera.position.z - target.position.z
    this.currentAngle = Math.atan2(dx, dz)
    const horiz = Math.hypot(dx, dz)
    const dy = camera.position.y - (target.position.y + this.height)
    this.currentElevation = Math.max(this.minElevation, Math.min(this.maxElevation, Math.atan2(dy, horiz)))
    this.selfHeight = target.position.y + this.height
    this.smoothLastPos.copy(target.position)
    this.smoothVelocity.set(0, 0, 0)
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

    // Track only the car's SPEED magnitude (never its direction) so a spinning
    // or drifting car can't swing the camera around.
    const velocity = target.position.clone().sub(this.smoothLastPos).divideScalar(dt)
    this.smoothLastPos.copy(target.position)
    velocity.y = 0
    this.smoothVelocity.lerp(velocity, Math.min(1.0, this.velocityDamping * dt))
    const speed = this.smoothVelocity.length()

    // Orbit angle is driven only by mouse drag, plus a gentle idle spin when
    // stationary. While moving it holds steady, so the car stays framed no
    // matter which way it is pointing.
    if (!this._isDragging && speed < 0.5) {
      this.currentAngle += 0.05 * dt  // ~2 min per revolution
    }

    // Smoothly track the vertical point we orbit around (the car).
    const wantedHeight = target.position.y + this.height
    const heightLerpFactor = Math.min(1.0, this.heightDamping * dt)
    this.selfHeight = this.selfHeight * (1 - heightLerpFactor) + wantedHeight * heightLerpFactor

    // Spherical placement: azimuth (drag left/right) + elevation (drag up/down).
    const horizontalDist = this.distance * Math.cos(this.currentElevation)
    const verticalOffset = this.distance * Math.sin(this.currentElevation)
    camera.position.set(
      target.position.x + Math.sin(this.currentAngle) * horizontalDist,
      this.selfHeight + verticalOffset,
      target.position.z + Math.cos(this.currentAngle) * horizontalDist
    )

    // Always look straight at the car so it stays centered regardless of heading.
    const lookAtPos = target.position.clone()
      .add(new THREE.Vector3(0, this.height * this.viewHeightRatio, 0))
    camera.lookAt(lookAtPos)
  }
}

// Camera rigidly attached to the car, preserving roll axis
class CameraFixed {
  constructor(offset, lookAtOffset, label = '') {
    this.label = label
    // Local-space offset from the car's position
    this.offset = offset.clone()
    // Local-space point to look at, relative to the car
    this.lookAtOffset = lookAtOffset.clone()
  }

  setOffset(x, y, z) {
    this.offset.set(x, y, z)
  }

  getOffset() {
    return this.offset.clone()
  }

  update(camera, target, deltaTime) {
    if (!target) return

    // Rotate local offset into world space using car's full quaternion (preserves roll).
    const worldPos = this.offset.clone().applyQuaternion(target.quaternion)
    camera.position.copy(target.position).add(worldPos)

    // Build camera orientation using car's up axis so roll is inherited.
    const worldLookAt = this.lookAtOffset.clone().applyQuaternion(target.quaternion).add(target.position)
    const worldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(target.quaternion)
    const m = new THREE.Matrix4().lookAt(camera.position, worldLookAt, worldUp)
    camera.quaternion.setFromRotationMatrix(m)
  }
}

class CameraSwitcher {
  constructor(scene) {
    this.scene = scene
    this.follow = new CameraFollow()
    this.helicopter = new CameraHelicopter()
    this.orbit = new CameraOrbit()
    // Bumper cam: low on the front of the car, looking forward
    this.bumper = new CameraFixed(
      new THREE.Vector3(0, 0.4, 2),     // front of car, just above bumper
      new THREE.Vector3(0, 0.3, 10),       // look far ahead
      'Bumper Cam'
    )
    // Side cam: low to the side
    this.side = new CameraFixed(
      new THREE.Vector3(0.8, 0.4, 0),      // left side, low
      new THREE.Vector3(0.5, 0.3, 2),         // look slightly ahead of car center
      'Side Cam'
    )
    // Hood cam: top of the hood, looking forward
    this.hood = new CameraFixed(
      new THREE.Vector3(0, 0.8, 0.5),      // center of hood
      new THREE.Vector3(0, 0.7, 10),          // look far ahead
      'Hood Cam'
    )

    // Ordered list of controllers; index drives everything.
    this.controllers = [this.follow, this.helicopter, this.orbit, this.bumper, this.hood, this.side]
    this._activeIndex = 0
    this.createUI()
  }

  get _activeController() {
    return this.controllers[this._activeIndex]
  }

  initFollow(camera, target) {
    this.follow.distance = 2.75
    this.follow.height = 1.3
    this.follow.heightDamping = 2.0
    this.follow.rotationDamping = 0.60
    this.follow.followVelocity = true
    this.follow.velocityDamping = 2.0
    this.follow.activate(camera, target)
  }

  getFixedCameraOffsets() {
    const bumper = this.bumper.getOffset()
    const hood   = this.hood.getOffset()
    const side   = this.side.getOffset()
    return {
      bumper: { x: bumper.x, y: bumper.y, z: bumper.z },
      hood:   { x: hood.x,   y: hood.y,   z: hood.z },
      side:   { x: side.x,   y: side.y,   z: side.z },
    }
  }

  setFixedCameraOffset(name, x, y, z) {
    if (name === 'bumper') this.bumper.setOffset(x, y, z)
    if (name === 'hood')   this.hood.setOffset(x, y, z)
    if (name === 'side')   this.side.setOffset(x, y, z)
  }

  createUI() {
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

    this.controllers.forEach((controller, i) => {
      const option = document.createElement('option')
      option.value = i
      option.textContent = `${i + 1}. ${controller.label}`
      option.style.cssText = 'background: #222; color: #fff;'
      this.select.appendChild(option)
    })

    this.select.value = this._activeIndex
    this.select.onchange = () => this.setController(Number(this.select.value))

    this.panel.appendChild(this.select)
    document.body.appendChild(this.panel)

    this._onKeyDown = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      // C cycles to next camera
      if (e.code === 'KeyC') {
        this.setController((this._activeIndex + 1) % this.controllers.length)
      }
      // 1–9 selects camera by index
      const digit = e.code.match(/^Digit(\d)$/)?.[1]
      if (digit !== undefined) {
        const i = Number(digit) - 1
        if (i >= 0 && i < this.controllers.length) this.setController(i)
      }
    }
    window.addEventListener('keydown', this._onKeyDown)
  }

  setController(index) {
    this._activeController?.deactivate?.(this.scene.camera)
    this._activeIndex = index
    this._activeController.activate?.(this.scene.camera, this._lastTarget)

    // Keep dropdown in sync
    if (this.select) {
      this.select.value = index
    }
  }

  update(camera, target, deltaTime) {
    if (!target) return
    this._lastTarget = target
    this._activeController.update(camera, target, deltaTime)
  }
}

export { CameraFollow, CameraHelicopter, CameraOrbit, CameraFixed, CameraSwitcher };
