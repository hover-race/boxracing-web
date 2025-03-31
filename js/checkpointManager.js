class CheckpointManager {
  constructor(scene) {
    this.scene = scene;
    this.checkpoints = [];
    this.finishLine = null;
    this.checkpointProgress = 0;
    this.lapCount = 0;
    this.car = null;
  }

  /**
   * Initialize the checkpoint manager with the player's car
   * @param {Vehicle} car - The player's car
   */
  init(car) {
    this.car = car;
    console.log("CheckpointManager initialized");
  }

  /**
   * Set up a finish line trigger at the given position
   * @param {THREE.Object3D} cube - The finish line volume object
   */
  setupFinishLine(cube) {
    console.log('Setting up finish line trigger at', cube.position);
    
    // Create a visible mesh for debugging purposes
    const geometry = new THREE.BoxGeometry(
      cube.scale.x * 2,
      cube.scale.y * 2,
      cube.scale.z * 2
    );
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.5
    });
    const visibleMesh = new THREE.Mesh(geometry, material);
    visibleMesh.position.copy(cube.position);
    visibleMesh.quaternion.copy(cube.quaternion);
    this.scene.scene.add(visibleMesh);
    
    // Create a ghost object with physics for collision detection
    const ghostObject = new THREE.Object3D();
    ghostObject.position.copy(cube.position);
    ghostObject.quaternion.copy(cube.quaternion);
    this.scene.scene.add(ghostObject);
    
    // Add physics to the ghost object (as a trigger volume)
    this.scene.physics.add.existing(ghostObject, {
      shape: 'box',
      width: cube.scale.x * 2,
      height: cube.scale.y * 2,
      depth: cube.scale.z * 2,
      mass: 0,  // Static object
      collisionFlags: 4  // CF_NO_CONTACT_RESPONSE - ghost object
    });
    
    // Set up collision detection
    const self = this; // Store reference to this for use in closure
    const finishLineBody = ghostObject.body;
    finishLineBody.on.collision((otherObject, event) => {
      if (otherObject === self.car.chassis) {
        if (event === 'start') {
          if (self.checkpointProgress === 0) {
            // Starting a new lap
            console.log('TRIGGER: Car crossed the start line!');
            self.checkpointProgress = 1;
          } else if (self.checkpointProgress === 2) {
            // Completed a lap (crossed finish after checkpoint)
            self.lapCount++;
            console.log(`TRIGGER: Lap ${self.lapCount} completed!`);
            self.checkpointProgress = 1; // Reset to 1 to start next lap
          } else {
            console.log('Finish line crossed but not in sequence - must cross checkpoint first');
          }
          
          // Flash the finish line mesh for visual feedback
          const originalOpacity = material.opacity;
          material.opacity = 0.9;
          setTimeout(() => {
            material.opacity = originalOpacity;
          }, 300);
        }
      }
    });
    
    // Store the finish line references
    this.finishLine = {
      ghost: ghostObject,
      mesh: visibleMesh,
      material: material
    };
  }

  /**
   * Set up a checkpoint trigger at the given position
   * @param {THREE.Object3D} cube - The checkpoint volume object
   * @param {number} checkpointIndex - The index of this checkpoint
   */
  setupCheckpoint(cube, checkpointIndex = 1) {
    console.log('Setting up checkpoint trigger at', cube.position);
    
    // Create a visible mesh for debugging purposes
    const geometry = new THREE.BoxGeometry(
      cube.scale.x * 2,
      cube.scale.y * 2,
      cube.scale.z * 2
    );
    const material = new THREE.MeshBasicMaterial({
      color: 0x0000ff,  // Blue color to distinguish from finish line
      transparent: true,
      opacity: 0.5
    });
    const visibleMesh = new THREE.Mesh(geometry, material);
    visibleMesh.position.copy(cube.position);
    visibleMesh.quaternion.copy(cube.quaternion);
    this.scene.scene.add(visibleMesh);
    
    // Create a ghost object with physics for collision detection
    const ghostObject = new THREE.Object3D();
    ghostObject.position.copy(cube.position);
    ghostObject.quaternion.copy(cube.quaternion);
    this.scene.scene.add(ghostObject);
    
    // Add physics to the ghost object (as a trigger volume)
    this.scene.physics.add.existing(ghostObject, {
      shape: 'box',
      width: cube.scale.x * 2,
      height: cube.scale.y * 2,
      depth: cube.scale.z * 2,
      mass: 0,  // Static object
      collisionFlags: 4  // CF_NO_CONTACT_RESPONSE - ghost object
    });
    
    // Set up collision detection
    const self = this; // Store reference to this for use in closure
    const checkpointBody = ghostObject.body;
    checkpointBody.on.collision((otherObject, event) => {
      if (otherObject === self.car.chassis) {
        if (event === 'start') {
          // Only count checkpoint if player has crossed the start/finish line
          if (self.checkpointProgress === 1) {
            console.log('TRIGGER: Car crossed checkpoint!');
            self.checkpointProgress = 2; // Mark checkpoint as crossed
            
            // Flash the checkpoint mesh for visual feedback
            const originalOpacity = material.opacity;
            material.opacity = 0.9;
            setTimeout(() => {
              material.opacity = originalOpacity;
            }, 300);
          } else {
            console.log('Checkpoint crossed but not in sequence - must cross finish line first');
          }
        }
      }
    });
    
    // Store the checkpoint reference
    this.checkpoints.push({
      index: checkpointIndex,
      ghost: ghostObject,
      mesh: visibleMesh,
      material: material
    });
  }

  /**
   * Get the current lap count
   * @returns {number} The current lap count
   */
  getLapCount() {
    return this.lapCount;
  }

  /**
   * Reset the lap and checkpoint tracking
   */
  reset() {
    this.checkpointProgress = 0;
    this.lapCount = 0;
    console.log("Checkpoint progress and lap count reset");
  }
}

// Export the CheckpointManager class
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CheckpointManager;
} else {
  // Browser environment
  window.CheckpointManager = CheckpointManager;
} 