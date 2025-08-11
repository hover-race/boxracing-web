class ControlsManager {
  constructor(scene) {
    this.scene = scene;
    this.joystick = null;
    this.tiltControlsActive = false;
    
    // Reset input controls to default state
    inputControls.steering = 0;
    inputControls.throttle = 0;
    inputControls.brake = 0;
    inputControls.handbrake = 0;
    
    // Initialize all control methods
    this.setupKeyboardControls();
    this.setupTouchControls();
    this.setupTiltControls();
  }
  
  setupKeyboardControls() {
    const keyEvent = (e, down) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          inputControls.throttle = down ? 1 : 0;
          break;
        case 'KeyA':
        case 'ArrowLeft': 
          inputControls.steering = down ? -1 : 0;
          break;
        case 'KeyS':
        case 'ArrowDown':
          inputControls.brake = down ? 1 : 0;
          break;
        case 'KeyD':
        case 'ArrowRight':
          inputControls.steering = down ? 1 : 0;
          break;
        case 'Space':
          inputControls.handbrake = down ? 1 : 0;
          break;
      }
    };
    
    document.addEventListener('keydown', e => keyEvent(e, true));
    document.addEventListener('keyup', e => keyEvent(e, false));
  }
  
  setupTouchControls() {
    // Initialize joystick
    this.joystick = nipplejs.create({
      zone: document.getElementById('joystick-zone'),
      mode: 'static',
      position: { left: '50%', bottom: '60px' },
      color: 'white',
      size: 220
    });

    // Handle joystick events
    this.joystick.on('move', (evt, data) => {
      const angle = data.angle.radian;
      const force = Math.min(data.force, 1.0);
      
      // Calculate analog inputs
      const forwardAmount = Math.sin(angle) * force;
      const steeringAmount = -Math.sin(angle - Math.PI/2) * force;

      // Update input controls
      inputControls.steering = steeringAmount;
      inputControls.throttle = Math.max(0, forwardAmount);
      inputControls.brake = Math.max(0, -forwardAmount);
    });

    // Handle joystick release
    this.joystick.on('end', () => {
      // Reset input controls
      inputControls.steering = 0;
      inputControls.throttle = 0;
      inputControls.brake = 0;
    });
  }
  
  setupTiltControls() {
    // Check if device orientation is supported
    if (!window.DeviceOrientationEvent) {
      console.log('Device orientation not supported');
      return;
    }

    const tiltSteeringEnabled = params.tiltSteering || false;
    
    if (!tiltSteeringEnabled) {
      console.log('Tilt steering is disabled in settings');
      return;
    }

    // For iOS devices, request permission
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then(permissionState => {
          if (permissionState === 'granted') {
            // Enable tilt controls
            this.enableTiltControls();
          } else {
            console.log('Permission to use device orientation was denied');
          }
        })
        .catch(console.error);
    } else {
      // For non-iOS devices, just enable tilt controls
      this.enableTiltControls();
    }
  }
  
  // Clean up method to remove event listeners
  cleanup() {
    if (this.joystick) {
      this.joystick.destroy();
    }
  }

  enableTiltControls() {
    // Set tilt controls as active
    this.tiltControlsActive = true;
    
    // Function to handle device orientation
    const handleOrientation = (event) => {
      // Only use tilt if controls are active
      if (!this.tiltControlsActive) return;
      vehicleParams.forceDirX = event.alpha;
      vehicleParams.forceDirZ = event.beta;
      vehicleParams.forceDirY = event.gamma;

      // Get alpha rotation (compass direction, 0-360)
      let alpha = event.alpha;

      // Normalize alpha to be centered around 0 (-180 to 180)
      // This helps in handling the wrap-around (e.g., 350 degrees becomes -10)
      if (alpha > 180) {
        alpha -= 360;
      }

      // Define the control range (degrees)
      const minAlpha = -30; // Corresponds to steering = 1 (turn right)
      const maxAlpha = 30;  // Corresponds to steering = -1 (turn left)

      // Clamp the normalized alpha to the control range [-30, 30]
      const clampedAlpha = Math.max(minAlpha, Math.min(maxAlpha, alpha));

      let tiltSteering = 0;
      // Check if alpha is within the active range to avoid mapping outside values
      if (clampedAlpha >= minAlpha && clampedAlpha <= maxAlpha) {
          // Linearly map clampedAlpha from [-30, 30] to steering [1, -1]
          // Formula: output = output_start + ((output_end - output_start) / (input_end - input_start)) * (input - input_start)
          tiltSteering = 1 + ((-1 - 1) / (maxAlpha - minAlpha)) * (clampedAlpha - minAlpha);
      }
      
      // Apply to steering if no joystick is active
      if (!this.joystick || !this.joystick.active) { // Added check for joystick existence
        inputControls.steering = tiltSteering;
      }
    };
    
    // Add orientation event listener
    window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    
    // Store the handler for cleanup
    this.orientationHandler = handleOrientation;
  }

  disableTiltControls() {
    // Set tilt controls as inactive
    this.tiltControlsActive = false;
    
    // Remove the orientation event listener if it exists
    if (this.orientationHandler) {
      window.removeEventListener('deviceorientation', this.orientationHandler, true);
      this.orientationHandler = null;
    }
  }
  
  update() {
    // Check if tilt controls are available on this device
    if (!this.tiltAvailable) {
      return; // Do nothing if tilt is not supported
    }
    
    // Check if tilt controls are enabled in the GUI
    const tiltSteeringEnabled = document.getElementById('tiltSteering')?.checked || false;
    
    // Enabling Tilt Controls (if checkbox is checked and not already active)
    if (tiltSteeringEnabled && !this.tiltControlsActive) {
      // Permission request is now handled by the GUI interaction
      console.log('ControlsManager.update: Enabling tilt controls.');
      this.enableTiltControls();
    } 
    // Disabling Tilt Controls (if checkbox is unchecked and currently active)
    else if (!tiltSteeringEnabled && this.tiltControlsActive) {
      console.log('ControlsManager.update: Disabling tilt controls.');
      this.disableTiltControls();
    }
  }
} 