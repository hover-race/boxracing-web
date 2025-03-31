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
  velocityFactor: 0.1,
  updateCamera: true,
  pushForce: 0,
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
  portalEnabled: true
}

gui.add(params, 'offlinePlay').name('Offline Play')
gui.add(params, 'velocityFactor', 0, 0.5).step(0.01)
gui.add(params, 'updateCamera')
gui.add(params, 'pushForce', -10, 10)
gui.add(params, 'sideForceMultiplier', -2000, 2000)
gui.add(params, 'asdf', -4000, 4000).listen()

// Add volume control
const volumeController = gui.add(params, 'volume', 0, 1).name('Volume')
volumeController.onChange((value) => {
  localStorage.setItem('volume', value)
})

// Add camera controls
const cameraFolder = gui.addFolder('Camera')
cameraFolder.add(params, 'updateCamera').name('Update Camera')
cameraFolder.add(params, 'velocityFactor', 0, 0.2).name('Look Ahead')

// Add network controls
const networkFolder = gui.addFolder('Network')
networkFolder.add(params, 'offlinePlay').name('Offline Mode')

// Add explosion controls
const explosionFolder = gui.addFolder('Explosion Settings')
explosionFolder.add(params, 'explosionEnabled').name('Enable Explosions')
explosionFolder.add(params, 'explosionForceThreshold', 5, 100).step(1).name('Impact Threshold')
explosionFolder.add(params, 'respawnDelay', 1000, 5000).step(100).name('Respawn Delay (ms)')
explosionFolder.add(params, 'particleCount', 10, 200).step(5).name('Particle Count')
explosionFolder.open()

// Add portal options
const portalFolder = gui.addFolder('Portal Settings')
portalFolder.add(params, 'portalEnabled').name('Enable VibeJam Portal').onChange((value) => {
  // This will be checked by the Portal class to determine if it should be visible
  if (window.mainScene && window.mainScene.portal) {
    window.mainScene.portal.setVisible(value);
  }
})

// Add portal customization options
const portalCustomization = {
  scale: 1.0,
  rotationSpeed: 0.01,
  floatAmplitude: 0.2,
  floatSpeed: 0.01
}

// Add scale slider
portalFolder.add(portalCustomization, 'scale', 0.5, 3.0).step(0.1).name('Portal Scale').onChange((value) => {
  if (window.mainScene && window.mainScene.portal) {
    window.mainScene.portal.setScale(value, value, value);
  }
});

// Add rotation speed slider
portalFolder.add(portalCustomization, 'rotationSpeed', 0.001, 0.05).step(0.001).name('Rotation Speed').onChange((value) => {
  if (window.mainScene && window.mainScene.portal) {
    window.mainScene.portal.rotationSpeed = value;
  }
});

// Add float amplitude slider
portalFolder.add(portalCustomization, 'floatAmplitude', 0, 1).step(0.05).name('Float Amount').onChange((value) => {
  if (window.mainScene && window.mainScene.portal) {
    window.mainScene.portal.floatAmplitude = value;
  }
});

// Add float speed slider
portalFolder.add(portalCustomization, 'floatSpeed', 0.001, 0.05).step(0.001).name('Float Speed').onChange((value) => {
  if (window.mainScene && window.mainScene.portal) {
    window.mainScene.portal.floatSpeed = value;
  }
});

portalFolder.open()

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
  volume: volumeControl.volume // Initialize with the volume control value
}

const vehicleData = gui.addFolder('Vehicle data')
vehicleData.open() // Make folder expanded by default
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