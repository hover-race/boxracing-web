const CameraMode = Object.freeze({
  FOLLOW: 'follow',
  OVERHEAD: 'overhead',
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

class CameraSwitcher {
  constructor(scene) {
    this.scene = scene
    this.mode = CameraMode.FOLLOW
    this.follow = new CameraFollow()
    this.helicopter = new CameraHelicopter()
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
    this.panel = document.createElement('div')
    this.panel.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 8px;
      z-index: 1000;
    `

    const btnStyle = (active) => `
      padding: 8px 16px;
      border: 1px solid #666;
      border-radius: 6px;
      color: #fff;
      font-family: monospace;
      font-size: 14px;
      cursor: pointer;
      background: ${active ? 'rgba(78, 205, 196, 0.8)' : 'rgba(0, 0, 0, 0.7)'};
    `

    this.followBtn = document.createElement('button')
    this.followBtn.textContent = 'Follow Cam'
    this.followBtn.style.cssText = btnStyle(true)
    this.followBtn.onclick = () => this.setMode(CameraMode.FOLLOW)

    this.overheadBtn = document.createElement('button')
    this.overheadBtn.textContent = 'Overhead Cam'
    this.overheadBtn.style.cssText = btnStyle(false)
    this.overheadBtn.onclick = () => this.setMode(CameraMode.OVERHEAD)

    this.panel.appendChild(this.followBtn)
    this.panel.appendChild(this.overheadBtn)
    document.body.appendChild(this.panel)
  }

  setMode(mode) {
    this.mode = mode
    if (mode === CameraMode.OVERHEAD) {
      this.helicopter.initFromCamera(this.scene.camera)
    }

    const activeStyle = 'rgba(78, 205, 196, 0.8)'
    const inactiveStyle = 'rgba(0, 0, 0, 0.7)'

    this.followBtn.style.background = mode === CameraMode.FOLLOW ? activeStyle : inactiveStyle
    this.overheadBtn.style.background = mode === CameraMode.OVERHEAD ? activeStyle : inactiveStyle
  }

  update(camera, target, deltaTime) {
    if (!target) return

    if (this.mode === CameraMode.OVERHEAD) {
      this.helicopter.update(camera, target, deltaTime)
    } else {
      this.follow.update(camera, target, deltaTime)
    }
  }
}

export { CameraMode, CameraFollow, CameraHelicopter, CameraSwitcher };
