class CheckpointManager {
  constructor(scene) {
    this.DEBUG_MESHES = false;

    this.scene = scene;
    this.checkpoints = [];
    this.finishLine = null;
    this.checkpointCount = 0;
    this.lapTimes = [];
    this.currentLapStartTime = 0;
    this.bestLapTime = Infinity;
    this.currentLap = 0;
    this.checkpointsPassed = new Set();
    this.finishLinePassed = false;
    this.lapCompleted = false;
    this.lastCheckpoint = null;
    this.lastCheckpointTime = 0;
    this.checkpointTimeout = 10000; // 10 seconds timeout for checkpoints
    this.lastLapTime = 0;
    
    // UI elements
    this.lapCountElement = document.getElementById('lap-count');
    this.currentLapTimeElement = document.getElementById('current-lap-time');
    this.bestLapTimeElement = document.getElementById('best-lap-time');
    
    // Start update loop for current lap timer
    this.updateTimerInterval = setInterval(() => this.updateCurrentLapTime(), 100);
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
   * Format milliseconds as a readable time string (M:SS.mmm)
   * @param {number} timeMs - Time in milliseconds
   * @returns {string} Formatted time string
   */
  formatTime(timeMs) {
    if (timeMs === Infinity || timeMs === 0) {
      return '--:--.---';
    }
    
    const minutes = Math.floor(timeMs / 60000);
    const seconds = Math.floor((timeMs % 60000) / 1000);
    const milliseconds = Math.floor(timeMs % 1000);
    
    return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
  }

  /**
   * Update the current lap timer display
   */
  updateCurrentLapTime() {
    if (this.currentLapStartTime === 0 || this.checkpointProgress === 0) {
      return;
    }
    
    const currentTime = performance.now();
    const lapTime = currentTime - this.currentLapStartTime;
    
    if (this.currentLapTimeElement) {
      this.currentLapTimeElement.textContent = `Current: ${this.formatTime(lapTime)}`;
    }
  }

  /**
   * Reset the lap timer
   */
  resetLapTimer() {
    this.currentLapStartTime = 0;
    if (this.currentLapTimeElement) {
      this.currentLapTimeElement.textContent = 'Current: 0:00.000';
    }
  }

  /**
   * Start timing a new lap
   */
  startLapTimer() {
    this.currentLapStartTime = performance.now();
  }

  /**
   * Complete the current lap and record time
   */
  completeLap() {
    if (this.currentLapStartTime === 0) {
      return;
    }
    
    const currentTime = performance.now();
    this.lastLapTime = currentTime - this.currentLapStartTime;
    
    // Check if this is a new best lap
    const isNewBest = this.lastLapTime < this.bestLapTime;
    if (isNewBest) {
      this.bestLapTime = this.lastLapTime;
      if (this.bestLapTimeElement) {
        this.bestLapTimeElement.textContent = `Best: ${this.formatTime(this.bestLapTime)}`;
        
        // Highlight the new best time with animation
        this.bestLapTimeElement.style.color = '#00ff00';
        this.bestLapTimeElement.style.fontSize = '22px';
        this.bestLapTimeElement.style.transition = 'all 0.3s ease';
        
        setTimeout(() => {
          this.bestLapTimeElement.style.color = 'white';
          this.bestLapTimeElement.style.fontSize = '18px';
        }, 2000);
      }
    }
    
    // Update lap count display with animation
    if (this.lapCountElement) {
      this.lapCount++;
      this.lapCountElement.textContent = `Lap: ${this.lapCount}`;
      this.lapCountElement.style.color = '#ffff00';
      this.lapCountElement.style.fontSize = '20px';
      this.lapCountElement.style.transition = 'all 0.3s ease';
      
      setTimeout(() => {
        this.lapCountElement.style.color = 'white';
        this.lapCountElement.style.fontSize = '18px';
      }, 1500);
    }
    
    // Display lap completion message
    this.showLapCompletionMessage(isNewBest);
    
    console.log(`Lap ${this.lapCount} completed in ${this.formatTime(this.lastLapTime)}`);
    
    // Reset timer for next lap
    this.currentLapStartTime = performance.now();
  }
  
  /**
   * Display a temporary message when a lap is completed
   * @param {boolean} isNewBest - Whether this was a new best lap time
   */
  showLapCompletionMessage(isNewBest) {
    // Create or get the message element
    let messageElement = document.getElementById('lap-completion-message');
    if (!messageElement) {
      messageElement = document.createElement('div');
      messageElement.id = 'lap-completion-message';
      messageElement.style.position = 'fixed';
      messageElement.style.top = '50%';
      messageElement.style.left = '50%';
      messageElement.style.transform = 'translate(-50%, -50%)';
      messageElement.style.color = 'white';
      messageElement.style.fontFamily = 'monospace';
      messageElement.style.fontSize = '28px';
      messageElement.style.fontWeight = 'bold';
      messageElement.style.textAlign = 'center';
      messageElement.style.background = 'rgba(0, 0, 0, 0.7)';
      messageElement.style.padding = '20px 30px';
      messageElement.style.borderRadius = '10px';
      messageElement.style.zIndex = '2000';
      messageElement.style.opacity = '0';
      messageElement.style.transition = 'opacity 0.5s ease';
      document.body.appendChild(messageElement);
    }
    
    // Set message text based on whether it's a new best lap
    if (isNewBest) {
      messageElement.innerHTML = `🏆 NEW BEST LAP! 🏆<br>${this.formatTime(this.lastLapTime)}`;
      messageElement.style.color = '#00ff00';
    } else {
      messageElement.innerHTML = `✅ LAP COMPLETE!<br>${this.formatTime(this.lastLapTime)}`;
      messageElement.style.color = 'white';
    }
    
    // Show message with fade in/out animation
    messageElement.style.opacity = '1';
    
    // Clear any existing timeout
    if (this.messageTimeout) {
      clearTimeout(this.messageTimeout);
    }
    
    // Hide message after delay
    this.messageTimeout = setTimeout(() => {
      messageElement.style.opacity = '0';
    }, 3000);
  }
  
  /**
   * Show a checkpoint passed message
   */
  showCheckpointMessage() {
    // Create or get the message element
    let messageElement = document.getElementById('checkpoint-message');
    if (!messageElement) {
      messageElement = document.createElement('div');
      messageElement.id = 'checkpoint-message';
      messageElement.style.position = 'fixed';
      messageElement.style.top = '60%';
      messageElement.style.left = '50%';
      messageElement.style.transform = 'translate(-50%, -50%)';
      messageElement.style.color = '#0088ff';
      messageElement.style.fontFamily = 'monospace';
      messageElement.style.fontSize = '24px';
      messageElement.style.fontWeight = 'bold';
      messageElement.style.textAlign = 'center';
      messageElement.style.background = 'rgba(0, 0, 0, 0.7)';
      messageElement.style.padding = '15px 25px';
      messageElement.style.borderRadius = '8px';
      messageElement.style.zIndex = '1900';
      messageElement.style.opacity = '0';
      messageElement.style.transition = 'opacity 0.5s ease';
      document.body.appendChild(messageElement);
    }
    
    // Set message text
    messageElement.textContent = '🔵 CHECKPOINT PASSED!';
    
    // Show message with fade in/out animation
    messageElement.style.opacity = '1';
    
    // Clear any existing timeout
    if (this.checkpointMessageTimeout) {
      clearTimeout(this.checkpointMessageTimeout);
    }
    
    // Hide message after delay
    this.checkpointMessageTimeout = setTimeout(() => {
      messageElement.style.opacity = '0';
    }, 2000);
  }

  /**
   * Set up a finish line trigger at the given position
   * @param {THREE.Object3D} cube - The finish line volume object
   */
  setupFinishLine(cube) {
    console.log('Setting up finish line trigger at', cube.position);
    
    if (this.DEBUG_MESHES) {
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
  }
    
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
            self.startLapTimer();
          } else if (self.checkpointProgress === 2) {
            // Completed a lap (crossed finish after checkpoint)
            self.lapCount++;
            console.log(`TRIGGER: Lap ${self.lapCount} completed!`);
            self.checkpointProgress = 1; // Reset to 1 to start next lap
            self.completeLap();
          } else {
            console.log('Finish line crossed but not in sequence - must cross checkpoint first');
          }
          
          if (this.DEBUG_MESHES) {
            // Flash the finish line mesh for visual feedback
            const originalOpacity = material.opacity;
            material.opacity = 0.9;
            setTimeout(() => {
              material.opacity = originalOpacity;
            }, 300);
          }
        }
      }
    });
    
    // Store the finish line references
    this.finishLine = {
      ghost: ghostObject,
    };
  }

  /**
   * Set up a checkpoint trigger at the given position
   * @param {THREE.Object3D} cube - The checkpoint volume object
   * @param {number} checkpointIndex - The index of this checkpoint
   */
  setupCheckpoint(cube, checkpointIndex = 1) {
    console.log('Setting up checkpoint trigger at', cube.position);
    
    if (this.DEBUG_MESHES) {
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
    }
    
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
            
            // Show checkpoint message
            self.showCheckpointMessage();
            
            // Flash the checkpoint mesh for visual feedback
            if (this.DEBUG_MESHES) {
              const originalOpacity = material.opacity;
              material.opacity = 0.9;
              setTimeout(() => {
                material.opacity = originalOpacity;
              }, 300);
            }
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
    this.resetLapTimer();
    this.bestLapTime = Infinity;
    
    // Update UI
    if (this.lapCountElement) {
      this.lapCountElement.textContent = 'Lap: 0';
    }
    if (this.bestLapTimeElement) {
      this.bestLapTimeElement.textContent = 'Best: --:--.---';
    }
    
    console.log("Checkpoint progress and lap count reset");
  }
  
  /**
   * Clean up resources when no longer needed
   */
  cleanup() {
    // Clear timer interval
    if (this.updateTimerInterval) {
      clearInterval(this.updateTimerInterval);
    }
    
    // Clear message timeouts
    if (this.messageTimeout) {
      clearTimeout(this.messageTimeout);
    }
    if (this.checkpointMessageTimeout) {
      clearTimeout(this.checkpointMessageTimeout);
    }
    
    // Remove UI elements
    const uiElements = [
      'lap-info-container', 
      'lap-completion-message', 
      'checkpoint-message'
    ];
    
    uiElements.forEach(id => {
      const element = document.getElementById(id);
      if (element && element.parentNode) {
        element.parentNode.removeChild(element);
      }
    });
  }
}

// Export the CheckpointManager class
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CheckpointManager;
} else {
  // Browser environment
  window.CheckpointManager = CheckpointManager;
} 