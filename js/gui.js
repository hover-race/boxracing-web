dat.GUI.TEXT_OPEN = 'Options'
dat.GUI.TEXT_CLOSED = 'Options'
const gui = new dat.GUI({ width: 400, closed: true })

// Load volume from localStorage or use default
const savedVolume = Number(localStorage.getItem('engineVolume'));
const defaultVolume = 50;

// Add volume control at the top level
const volumeControl = {
  volume: !isNaN(savedVolume) ? savedVolume : defaultVolume
}

// Add volume slider (0-100%) at the top
gui.add(volumeControl, 'volume', 0, 100).step(1)
  .name('Engine Volume %')
  .onChange((value) => {
    vehicleParams.volume = value;
    localStorage.setItem('engineVolume', value);
  });

// Input controls folder at the top
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
}

gui.add(params, 'offlinePlay').name('Offline Play')
gui.add(params, 'velocityFactor', 0, 0.5).step(0.01)
gui.add(params, 'updateCamera')
gui.add(params, 'pushForce', -10, 10)
gui.add(params, 'sideForceMultiplier', -2000, 2000)
gui.add(params, 'asdf', -4000, 4000).listen()

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