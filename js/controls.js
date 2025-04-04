
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
    // Only proceed if device orientation is supported
    if (!window.DeviceOrientationEvent) return;
    
    // Check if device is in landscape mode
    const isLandscape = () => window.innerWidth > window.innerHeight;
    
    // Function to handle device orientation
    const handleOrientation = (event) => {
      // Only use tilt in landscape mode
      if (!isLandscape() || !this.tiltControlsActive) return;
      
      // Get gamma rotation (left-right tilt)
      const gamma = event.gamma;
      
      // Convert gamma (-90 to 90) to steering (-1 to 1)
      // Use a smaller range (±30°) for more precise control
      const tiltSteering = Math.max(-1, Math.min(1, gamma / 30));
      
      // Apply to steering if no touch controls are active
      if (!this.joystick.active) {
        inputControls.steering = tiltSteering;
      }
    };
    
    // Add orientation event listener
    window.addEventListener('deviceorientation', handleOrientation, true);
    
    // Add button to toggle tilt controls
    const tiltButton = document.createElement('button');
    tiltButton.id = 'tilt-steering-btn';
    tiltButton.textContent = 'Enable Tilt Steering';
    tiltButton.style.position = 'fixed';
    tiltButton.style.bottom = '20px';
    tiltButton.style.right = '20px';
    tiltButton.style.padding = '10px';
    tiltButton.style.zIndex = '1000';
    document.body.appendChild(tiltButton);
    
    // Toggle tilt controls on button click
    tiltButton.addEventListener('click', () => {
      this.tiltControlsActive = !this.tiltControlsActive;
      tiltButton.textContent = this.tiltControlsActive ? 'Disable Tilt Steering' : 'Enable Tilt Steering';
      
      // Request permission if needed (iOS 13+)
      if (this.tiltControlsActive && DeviceOrientationEvent.requestPermission) {
        DeviceOrientationEvent.requestPermission()
          .then(response => {
            if (response !== 'granted') {
              this.tiltControlsActive = false;
              tiltButton.textContent = 'Enable Tilt Steering';
              alert('Permission to use device orientation was denied');
            }
          })
          .catch(console.error);
      }
    });
    
    // Update button visibility based on orientation
    window.addEventListener('resize', () => {
      tiltButton.style.display = isLandscape() ? 'block' : 'none';
    });
    
    // Initial visibility
    tiltButton.style.display = isLandscape() ? 'block' : 'none';
  }
  
  // Clean up method to remove event listeners
  cleanup() {
    if (this.joystick) {
      this.joystick.destroy();
    }
  }
} 