class CameraSmoothFollow {
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

// Helper function to create and configure a CameraSmoothFollow instance
function setupCamera(camera, target) {
  const cameraController = new CameraSmoothFollow();
  cameraController.reset(camera, target);
  
  // Configure with good default settings
  cameraController.distance = 2.75;
  cameraController.height = 1.3;
  cameraController.heightDamping = 2.0;
  cameraController.rotationDamping = 3.0;
  cameraController.followVelocity = true;
  cameraController.velocityDamping = 5.0;
  
  return cameraController;
}
