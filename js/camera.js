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
    this.selfHeight = camera.position.y;
  }

  update(camera, target, deltaTime) {
    if (!target || deltaTime <= 0) return;
    if (!target) return;

    // Calculate velocity
    const currentPos = target.position.clone();
    const updatedVelocity = currentPos.sub(this.smoothLastPos).divideScalar(deltaTime);
    if (this.lookBehind) updatedVelocity.multiplyScalar(-1);
    this.smoothLastPos.copy(target.position);

    updatedVelocity.y = 0.0;

    // Update smooth velocity if moving
    if (updatedVelocity.length() > 1.0) {
      // Lerp velocity
      this.smoothVelocity.lerp(updatedVelocity, this.velocityDamping * deltaTime);
      this.smoothTargetAngle = Math.atan2(this.smoothVelocity.x, this.smoothVelocity.z);
    }

    if (!this.followVelocity) {
      this.smoothTargetAngle = target.rotation.y;
    }

    // Calculate desired height
    const wantedHeight = target.position.y + this.height;

    // Smooth rotation and height
    this.selfRotationAngle = this.lerpAngle(this.selfRotationAngle, this.smoothTargetAngle, this.rotationDamping * deltaTime);
    this.selfHeight = THREE.MathUtils.lerp(this.selfHeight, wantedHeight, this.heightDamping * deltaTime);

    // Calculate camera position
    const rotation = new THREE.Euler(0, this.selfRotationAngle, 0);
    const direction = new THREE.Vector3(0, 0, 1).applyEuler(rotation);
    
    const newPosition = target.position.clone()
      .sub(direction.multiplyScalar(this.distance));
    newPosition.y = this.selfHeight;

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

// Camera system for smooth following with damping
function setupCamera(camera, target) {
  const cameraController = {
    // Configuration
    distance: 5,           // Distance behind target
    height: 2,             // Height above target
    damping: 0.05,         // How quickly camera moves (0-1)
    lookAheadFactor: 0.2,  // How much to look ahead based on velocity
    
    // Current state
    currentPosition: new THREE.Vector3(),
    currentLookAt: new THREE.Vector3(),
    
    // Update method
    update: function(camera, target, deltaTime) {
      // Get target position
      const targetPosition = target.getWorldPosition(new THREE.Vector3());
      
      // Calculate ideal camera position (behind and above target)
      const idealPosition = targetPosition.clone();
      idealPosition.y += this.height;
      
      // Get target's forward direction
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(target.quaternion);
      
      // Move camera back along forward direction
      idealPosition.sub(forward.multiplyScalar(this.distance));
      
      // Calculate look-ahead position based on velocity
      const velocity = target.body.velocity;
      const lookAhead = targetPosition.clone().add(
        new THREE.Vector3(velocity.x, 0, velocity.z).multiplyScalar(this.lookAheadFactor)
      );
      
      // Initialize current position if needed
      if (this.currentPosition.lengthSq() === 0) {
        this.currentPosition.copy(idealPosition);
        this.currentLookAt.copy(targetPosition);
      }
      
      // Smoothly move current position toward ideal position
      const lerpFactor = Math.min(1, this.damping * (deltaTime || 1/60));
      this.currentPosition.lerp(idealPosition, lerpFactor);
      this.currentLookAt.lerp(lookAhead, lerpFactor);
      
      // Apply to actual camera
      camera.position.copy(this.currentPosition);
      camera.lookAt(this.currentLookAt);
    }
  };
  
  return cameraController;
}
