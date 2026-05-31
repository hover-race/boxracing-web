dat.GUI.TEXT_OPEN = 'Options'
dat.GUI.TEXT_CLOSED = 'Options'
const gui = new dat.GUI({ width: 400, closed: true })

window.addEventListener('keydown', (e) => {
  if (e.key === '`') {
    if (gui.closed) gui.open()
    else gui.close()
  }
})

// Generate default player name with 3 random digits
function generateDefaultPlayerName() {
  const randomNum = Math.floor(Math.random() * 900) + 100; // generates number between 100-999
  return `Player${randomNum}`;
}

// Load player name and volume from localStorage
const savedPlayerName = (() => {
  const name = localStorage.getItem('playerName') || generateDefaultPlayerName();
  return name.length > 12 ? name.substring(0, 12) + '.' : name;
})();
const savedVolume = Number(localStorage.getItem('engineVolume'));
const defaultVolume = 50;

// Add player name at the very top
const playerControl = {
  name: savedPlayerName
}

// Add player name input at the top
gui.add(playerControl, 'name')
  .name('Player Name')
  .onChange((value) => {
    // Truncate to 12 characters and add period if longer
    if (value.length > 12) {
      value = value.substring(0, 12) + '.';
      // Update the input field to show truncated value
      playerControl.name = value;
    }
    
    params.playerName = value;
    localStorage.setItem('playerName', value);
  });

// Add volume control
const volumeControl = {
  volume: !isNaN(savedVolume) ? savedVolume : defaultVolume
}

// Add volume slider (0-100%)
gui.add(volumeControl, 'volume', 0, 100).step(1)
  .name('Engine Volume %')
  .onChange((value) => {
    vehicleParams.volume = value;
    localStorage.setItem('engineVolume', value);
  });

// Input controls folder
const inputControls = {
  steering: 0,    // -1 to 1
  throttle: 0,    // 0 to 1
  brake: 0,       // 0 to 1
  handbrake: 0    // 0 to 1
}
const inputFolder = gui.addFolder('Inputs')
inputFolder.add(inputControls, 'steering', -1, 1).step(0.01).listen()
inputFolder.add(inputControls, 'throttle', 0, 1).step(0.01).listen()
inputFolder.add(inputControls, 'brake', 0, 1).step(0.01).listen()
inputFolder.add(inputControls, 'handbrake', 0, 1).step(0.01).listen()
inputFolder.open()

const params = {
  offlinePlay: false,
  updateCamera: true,
  sideForceMultiplier: 1,
  asdf: 8000,
  analogControls: true,
  tractionControl: false,
  tcSlipLimit: 0.25,
  tcStrength: 2,
  tcMaxCut: 0.75,
  wheelInertia: 1.2,
  engineTorque: 700,
  brakeTorque: 450,
  tireLongitudinalStiffness: 12,
  tireLateralStiffness: 2,
  tireSlipDamping: 450,
  maxWheelAngularVelocity: 220,
  tireGrip: 0.8,
  smokeEnabled: true,
  smokeSlipThreshold: 0.25,
  smokeRate: 45,
  maxSmokeParticles: 160,
  // Initialize player name with 12-char limit
  playerName: (() => {
    const name = localStorage.getItem('playerName') || generateDefaultPlayerName();
    return name.length > 12 ? name.substring(0, 12) + '.' : name;
  })(),
  volume: parseFloat(localStorage.getItem('volume')) || 1.0,
  explosionEnabled: true,
  explosionForceThreshold: 50,
  respawnDelay: 1000,
  particleCount: 100,
  portalEnabled: true,
  // Add tilt steering option, default to true on mobile
  tiltSteering: (() => {
    // Check if device is mobile
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    // Get saved value or default to true on mobile
    const savedValue = localStorage.getItem('tiltSteering');
    return savedValue !== null ? savedValue === 'true' : isMobile;
  })()
}

gui.useLocalStorage = true
gui.remember(params)

gui.add(params, 'offlinePlay').name('Offline Play')
gui.add(params, 'updateCamera')
gui.add(params, 'explosionEnabled')

const tractionFolder = gui.addFolder('Traction / Slip')
tractionFolder.add(params, 'tractionControl').name('Traction Control')
tractionFolder.add(params, 'tcSlipLimit', 0.05, 1).step(0.01).name('TC Slip Limit')
tractionFolder.add(params, 'tcStrength', 0, 8).step(0.1).name('TC Strength')
tractionFolder.add(params, 'tcMaxCut', 0, 1).step(0.01).name('TC Max Cut')
tractionFolder.add(params, 'wheelInertia', 0.2, 5).step(0.1).name('Wheel Inertia')
tractionFolder.add(params, 'engineTorque', 0, 3000).step(25).name('Engine Torque')
tractionFolder.add(params, 'brakeTorque', 0, 2000).step(25).name('Brake Torque')
tractionFolder.add(params, 'tireLongitudinalStiffness', 1, 30).step(0.5).name('Long Stiffness')
tractionFolder.add(params, 'tireLateralStiffness', 0.1, 20).step(0.1)
tractionFolder.add(params, 'tireSlipDamping', 0, 2000).step(25).name('Slip Damping')
tractionFolder.add(params, 'maxWheelAngularVelocity', 20, 500).step(10).name('Max Wheel Speed')
tractionFolder.add(params, 'tireGrip', 0.1, 2).step(0.05).name('Tire Grip')
tractionFolder.add(params, 'smokeEnabled').name('Smoke')
tractionFolder.add(params, 'smokeSlipThreshold', 0.05, 1).step(0.01).name('Smoke Slip')
tractionFolder.add(params, 'smokeRate', 0, 120).step(1).name('Smoke Rate')


// Add volume control
const volumeController = gui.add(params, 'volume', 0, 1).name('Volume')
volumeController.onChange((value) => {
  localStorage.setItem('volume', value)
})

// Add tilt steering checkbox
const tiltSteeringController = gui.add(params, 'tiltSteering').name('Tilt Steering')
tiltSteeringController.onChange((value) => {
  // Save to localStorage
  localStorage.setItem('tiltSteering', value);

  // Only request permission when the checkbox is checked (value is true)
  if (value) {
    console.log('GUI: Tilt steering checked. Requesting permission if needed.');
    // Directly check for iOS permission requirement and request if applicable
    if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
      window.DeviceOrientationEvent.requestPermission()
        .then(permissionState => {
          if (permissionState === 'granted') {
            console.log('GUI: Device orientation permission granted via checkbox.');
            // ControlsManager.update() will eventually enable if manager exists
          } else {
            console.log('GUI: Permission denied via checkbox.');
            // Uncheck the box if permission is denied
            params.tiltSteering = false;
            tiltSteeringController.updateDisplay();
          }
        })
        .catch(error => {
          console.error('GUI: Error requesting permission via checkbox:', error);
          // Uncheck the box on error
          params.tiltSteering = false;
          tiltSteeringController.updateDisplay();
        });
    } else if (window.DeviceOrientationEvent) {
      // Non-iOS device where DeviceOrientationEvent exists but no permission needed
      console.log('GUI: Tilt controls enabled via checkbox (no permission needed).');
      // ControlsManager.update() will eventually enable if manager exists
    } else {
      // DeviceOrientationEvent is not supported at all
      console.warn('GUI: Tilt controls checked, but DeviceOrientationEvent is not supported.');
      // Uncheck the box as it cannot be used
      params.tiltSteering = false;
      tiltSteeringController.updateDisplay();
    }
  } else {
    // When unchecking, ControlsManager.update() will handle disabling
    console.log('GUI: Tilt controls unchecked via checkbox.');
  }
});

const vehicleParams = {
  speed: 0, // Will be updated from code
  slipRatio: 0,
  slipValue: 0,
  rearLeftSlipRatio: 0,
  slipAngle: 0,
  sideForceScalar: 0,
  isSlipping: false,
  wheelSpinVelocity: 0,
  skidInfo: 0,
  turnAngle: 0,
  extraRotation: 0,
  forceDirX: 0,
  forceDirY: 0,
  forceDirZ: 0,
  forwardForceScalar: 0,
  volume: volumeControl.volume, // Initialize with the volume control value
  steeringSensitivity: 1.0, // Default sensitivity multiplier
}

gui.add(vehicleParams, 'wheelSpinVelocity', -200, 200).step(0.1).name('Wheel Angular Speed').listen()

tractionFolder.add(vehicleParams, 'slipValue', 0, 1).step(0.01).name('Slip').listen()

const debugFolder = gui.addFolder('Debug')
debugFolder.close()
const speedController = debugFolder.add(vehicleParams, 'speed', 0, 200)
debugFolder.add(vehicleParams, 'sideForceScalar', -2000, 2000).listen()
debugFolder.add(vehicleParams, 'forwardForceScalar', -4000, 4000).listen()
debugFolder.add(vehicleParams, 'slipAngle', -20, 20).step(0.1).listen()
debugFolder.add(vehicleParams, 'rearLeftSlipRatio', -1, 1).step(0.01).name('Rear Left Slip').listen()
debugFolder.add(vehicleParams, 'isSlipping').name('Rear Left Slipping').listen()
debugFolder.add(vehicleParams, 'wheelSpinVelocity', -200, 200).step(0.1).name('Extra Spin').listen()

const slipRatioController = debugFolder.add(vehicleParams, 'slipRatio', -1, 1).step(0.01)
slipRatioController.listen() // Makes it read-only and updates when value changes

const turnAngleController = debugFolder.add(vehicleParams, 'turnAngle', -0.5, 0.5).step(0.01)
turnAngleController.listen() // Makes it read-only and updates when value changes

// Add force direction controllers
const forceFolder = debugFolder.addFolder('Force Direction')
const forceDirXController = forceFolder.add(vehicleParams, 'forceDirX', -100, 100).step(0.1)
forceDirXController.listen()
const forceDirYController = forceFolder.add(vehicleParams, 'forceDirY', -100, 100).step(0.1)
forceDirYController.listen()
const forceDirZController = forceFolder.add(vehicleParams, 'forceDirZ', -100, 100).step(0.1)
forceDirZController.listen()

forceFolder.open()

// Add steering sensitivity to the inputs folder
inputFolder.add(vehicleParams, 'steeringSensitivity', 0.1, 2.0).step(0.1).name('Steering Sensitivity')
  .onChange(value => {
    // Store the value in vehicleParams for the car to access
    vehicleParams.steeringSensitivity = value;
  }); 

// Fixed camera offsets (editable from GUI)
const fixedCameraParams = {
  bumperX: 0,   bumperY: 0.4, bumperZ: 2,
  hoodX: 0,     hoodY: 0.8,   hoodZ: 0.5,
  sideX: 0.8,   sideY: 0.4,   sideZ: 0,
}

let boundCameraSwitcher = null

function applyFixedCameraOffsets() {
  if (!boundCameraSwitcher) return
  boundCameraSwitcher.setFixedCameraOffset('bumper', fixedCameraParams.bumperX, fixedCameraParams.bumperY, fixedCameraParams.bumperZ)
  boundCameraSwitcher.setFixedCameraOffset('hood',   fixedCameraParams.hoodX,   fixedCameraParams.hoodY,   fixedCameraParams.hoodZ)
  boundCameraSwitcher.setFixedCameraOffset('side',   fixedCameraParams.sideX,   fixedCameraParams.sideY,   fixedCameraParams.sideZ)
}

const fixedCamFolder = gui.addFolder('Cameras')
fixedCamFolder.add(fixedCameraParams, 'bumperX', -3, 3).step(0.01).name('Bumper X').onChange(applyFixedCameraOffsets)
fixedCamFolder.add(fixedCameraParams, 'bumperY', -1, 3).step(0.01).name('Bumper Y').onChange(applyFixedCameraOffsets)
fixedCamFolder.add(fixedCameraParams, 'bumperZ', -3, 8).step(0.01).name('Bumper Z').onChange(applyFixedCameraOffsets)
fixedCamFolder.add(fixedCameraParams, 'hoodX',   -3, 3).step(0.01).name('Hood X').onChange(applyFixedCameraOffsets)
fixedCamFolder.add(fixedCameraParams, 'hoodY',   -1, 3).step(0.01).name('Hood Y').onChange(applyFixedCameraOffsets)
fixedCamFolder.add(fixedCameraParams, 'hoodZ',   -3, 8).step(0.01).name('Hood Z').onChange(applyFixedCameraOffsets)
fixedCamFolder.add(fixedCameraParams, 'sideX',   -3, 3).step(0.01).name('Side X').onChange(applyFixedCameraOffsets)
fixedCamFolder.add(fixedCameraParams, 'sideY',   -1, 3).step(0.01).name('Side Y').onChange(applyFixedCameraOffsets)
fixedCamFolder.add(fixedCameraParams, 'sideZ',   -3, 8).step(0.01).name('Side Z').onChange(applyFixedCameraOffsets)
fixedCamFolder.close()

window.bindCameraSwitcherToGui = (cameraSwitcher) => {
  boundCameraSwitcher = cameraSwitcher
  const offsets = boundCameraSwitcher.getFixedCameraOffsets?.()
  if (offsets) {
    if (offsets.bumper) { fixedCameraParams.bumperX = offsets.bumper.x; fixedCameraParams.bumperY = offsets.bumper.y; fixedCameraParams.bumperZ = offsets.bumper.z }
    if (offsets.hood)   { fixedCameraParams.hoodX   = offsets.hood.x;   fixedCameraParams.hoodY   = offsets.hood.y;   fixedCameraParams.hoodZ   = offsets.hood.z }
    if (offsets.side)   { fixedCameraParams.sideX   = offsets.side.x;   fixedCameraParams.sideY   = offsets.side.y;   fixedCameraParams.sideZ   = offsets.side.z }
    for (const controller of fixedCamFolder.__controllers) controller.updateDisplay()
  }
  applyFixedCameraOffsets()
}