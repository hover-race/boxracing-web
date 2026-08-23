import { on } from './raceEvents.js'

class ControlsManager {
  constructor(scene) {
    this.scene = scene;
    this.pad = { up: false, down: false, left: false, right: false };
    this.tiltControlsActive = false;
    
    this.clearInputs();
    
    // Initialize all control methods
    this.setupKeyboardControls();
    this.setupTouchControls();
    this.setupTiltControls();
    this.setupRaceInputGate();
  }

  clearInputs() {
    inputControls.steering = 0;
    inputControls.throttle = 0;
    inputControls.brake = 0;
    inputControls.handbrake = 0;
  }

  setupRaceInputGate() {
    on('countdownStart', () => {
      inputControls.enabled = false;
      this.clearInputs();
    });
    on('raceStart', () => {
      inputControls.enabled = true;
    });
  }
  
  setupKeyboardControls() {
    const isEditable = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };

    const keyEvent = (e, down) => {
      if (!inputControls.enabled) {
        if (e.code === 'KeyW' || e.code === 'ArrowUp') {
          inputControls.throttle = down ? 1 : 0;
          e.preventDefault();
        }
        return;
      }
      // Don't drive the car while typing into a GUI field; let the input keep the event.
      if (isEditable(e.target)) return;

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
        default:
          return;
      }
      // The game consumed this key; stop browser defaults (page scroll, etc.).
      e.preventDefault();
    };
    
    document.addEventListener('keydown', e => keyEvent(e, true));
    document.addEventListener('keyup', e => keyEvent(e, false));
  }
  
  setupTouchControls() {
    const pad = document.getElementById('arrow-pad')
    if (!pad) return
    pad.addEventListener('contextmenu', (e) => e.preventDefault())

    const syncPad = () => {
      inputControls.throttle = this.pad.up ? 1 : 0
      if (!inputControls.enabled) {
        inputControls.steering = 0
        inputControls.brake = 0
        return
      }
      inputControls.brake = this.pad.down ? 1 : 0
      inputControls.steering = (this.pad.right ? 1 : 0) - (this.pad.left ? 1 : 0)
    }

    const setPad = (dir, down, button) => {
      this.pad[dir] = down
      button.classList.toggle('is-down', down)
      syncPad()
    }

    for (const button of pad.querySelectorAll('[data-pad]')) {
      const dir = button.dataset.pad
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        button.setPointerCapture(e.pointerId)
        setPad(dir, true, button)
      })
      button.addEventListener('pointerup', () => setPad(dir, false, button))
      button.addEventListener('pointercancel', () => setPad(dir, false, button))
    }
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
  cleanup() {}

  enableTiltControls() {
    // Set tilt controls as active
    this.tiltControlsActive = true;
    
    // Function to handle device orientation
    const handleOrientation = (event) => {
      if (!this.tiltControlsActive || !inputControls.enabled) return;
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
      
      if (!this.pad.left && !this.pad.right) {
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

export { ControlsManager }; 