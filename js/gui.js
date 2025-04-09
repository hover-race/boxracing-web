dat.GUI.TEXT_OPEN = 'Options'
dat.GUI.TEXT_CLOSED = 'Options'
const gui = new dat.GUI({ width: 400, closed: true })

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

gui.add(params, 'offlinePlay').name('Offline Play')
gui.add(params, 'updateCamera')

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
  // Update controls manager if it exists
  if (window.scene && window.scene.controlsManager) {
    window.scene.controlsManager.tiltControlsActive = value;
  }
});

const vehicleParams = {
  speed: 0, // Will be updated from code
  slipRatio: 0,
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

const vehicleData = gui.addFolder('Vehicle data')
vehicleData.close()
const speedController = vehicleData.add(vehicleParams, 'speed', 0, 200)
vehicleData.add(vehicleParams, 'sideForceScalar', -2000, 2000).listen()
vehicleData.add(vehicleParams, 'forwardForceScalar', -4000, 4000).listen()
vehicleData.add(vehicleParams, 'slipAngle', -20, 20).step(0.1).listen()

const slipRatioController = vehicleData.add(vehicleParams, 'slipRatio', -1, 1).step(0.01)
slipRatioController.listen() // Makes it read-only and updates when value changes

const turnAngleController = vehicleData.add(vehicleParams, 'turnAngle', -0.5, 0.5).step(0.01)
turnAngleController.listen() // Makes it read-only and updates when value changes

// Add force direction controllers
const forceFolder = vehicleData.addFolder('Force Direction')
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