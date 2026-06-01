dat.GUI.TEXT_OPEN = 'Options'
dat.GUI.TEXT_CLOSED = 'Options'
const gui = new dat.GUI({ width: 400 })

window.addEventListener('keydown', (e) => {
  if (e.key === '`') {
    if (gui.closed) gui.open()
    else gui.close()
  }
})

function generateDefaultPlayerName() {
  const randomNum = Math.floor(Math.random() * 900) + 100;
  return `Player${randomNum}`;
}

// Inputs consumed by controls.js / the main loop
const inputControls = {
  steering: 0,
  throttle: 0,
  brake: 0,
  handbrake: 0
}

// Player identity (used by Vehicle.serialize / networking)
const playerControl = {
  name: (() => {
    const name = localStorage.getItem('playerName') || generateDefaultPlayerName();
    return name.length > 12 ? name.substring(0, 12) + '.' : name;
  })()
}

const params = {
  offlinePlay: false,
  updateCamera: true,
  analogControls: true,
  tractionControl: false,
  tcSlipLimit: 0.25,
  tcStrength: 2,
  tcMaxCut: 0.75,
  spinPrevention: true,
  spinAssist: 0.5,
  wheelInertia: 1.2,
  engineTorque: 700,
  brakeTorque: 450,
  tireLongitudinalStiffness: 12,
  tireLateralStiffness: 2,
  tireSlipDamping: 450,
  maxWheelAngularVelocity: 220,
  throttleInput: 0,
  runPhysics: true,
  autoStopPhysicsAfterSec: 0,
  smokeEnabled: false,
  smokeSlipThreshold: 0.25,
  smokeRate: 45,
  maxSmokeParticles: 160,
  playerName: playerControl.name,
  soundVolume: 50,
  explosionEnabled: true,
  explosionForceThreshold: 50,
  respawnDelay: 1000,
  particleCount: 100,
  portalEnabled: true,
  tiltSteering: (() => {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const savedValue = localStorage.getItem('tiltSteering');
    return savedValue !== null ? savedValue === 'true' : isMobile;
  })()
}

const vehicleParams = {
  speed: 0,
  slipRatio: 0,
  slipAngle: 0,
  wheelSpeed: 0,
  wheelSpinVelocity: 0,
  slipValue: 0,
  rearLeftSlipRatio: 0,
  sideForceScalar: 0,
  forwardForceScalar: 0,
  isSlipping: false,
  skidInfo: 0,
  extraRotation: 0,
  forceDirX: 0,
  forceDirY: 0,
  forceDirZ: 0,
  yawRate: 0,
  yawRateTarget: 0,
  yawRateError: 0,
  spinAssistCut: 0,
  escBrake: 0,
  curThrottle: 0,
  spinAssistActive: false,
  oversteerMetric: 0,
  oversteerZone: 'stable',
  steeringSensitivity: 1.0,
  wheelSteerAngle: 0,
}

gui.useLocalStorage = true
gui.remember(params)

gui.add(params, 'smokeEnabled')
gui.add(params, 'soundVolume', 0, 100).step(1)

const stabilityFolder = gui.addFolder('Stability Control')
stabilityFolder.add(params, 'tractionControl')
stabilityFolder.add(params, 'tcSlipLimit', 0, 1).step(0.01)
stabilityFolder.add(params, 'tcStrength', 0, 10).step(0.1)
stabilityFolder.add(params, 'tcMaxCut', 0, 1).step(0.01)
stabilityFolder.add(params, 'spinPrevention')
stabilityFolder.add(params, 'spinAssist', 0, 1).step(0.25)

const debugFolder = gui.addFolder('Debug')
debugFolder.add(params, 'throttleInput', -1, 1).step(0.01)
debugFolder.add(params, 'runPhysics')
debugFolder.add(params, 'autoStopPhysicsAfterSec')
debugFolder.add(vehicleParams, 'wheelSpeed', -50, 50).step(0.1).listen()
debugFolder.add(vehicleParams, 'slipRatio', -1, 1).step(0.01).listen()
debugFolder.add(vehicleParams, 'slipAngle', -90, 90).step(0.1).listen()
debugFolder.add(vehicleParams, 'forwardForceScalar', -8000, 8000).step(1).listen()
debugFolder.add(vehicleParams, 'sideForceScalar', -8000, 8000).step(1).listen()
debugFolder.add(vehicleParams, 'wheelSteerAngle', -35, 35).step(0.1).listen()
debugFolder.add(vehicleParams, 'yawRate', -2, 2).step(0.01).listen()
debugFolder.add(vehicleParams, 'yawRateTarget', -2, 2).step(0.01).listen()
debugFolder.add(vehicleParams, 'yawRateError', -2, 2).step(0.01).listen()
debugFolder.add(vehicleParams, 'spinAssistCut', 0, 1).step(0.01).listen()
debugFolder.add(vehicleParams, 'escBrake', 0, 40).step(1).listen()
debugFolder.add(vehicleParams, 'curThrottle', -1, 1).step(0.01).listen()
debugFolder.add(vehicleParams, 'spinAssistActive').listen()
debugFolder.add(vehicleParams, 'oversteerMetric', 0, 2).step(0.01).listen()
debugFolder.add(vehicleParams, 'oversteerZone').listen()

// Debug overrides from URL query, e.g. ?throttleInput=1&engineTorque=900&autoStopPhysics=true
// Applied after gui.remember/localStorage restore so the URL is authoritative.
function applyUrlParamOverrides() {
  const query = new URLSearchParams(window.location.search)
  for (const [key, raw] of query) {
    if (!(key in params)) continue
    const current = params[key]
    if (typeof current === 'boolean') params[key] = raw === 'true' || raw === '1'
    else if (typeof current === 'number') params[key] = Number(raw)
    else params[key] = raw
  }
  gui.__controllers.forEach((c) => c.updateDisplay())
}
applyUrlParamOverrides()

gui.close()

window.bindCameraSwitcherToGui = () => {}
