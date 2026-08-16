// Dont use .name - keep variables searchable.

dat.GUI.TEXT_OPEN = 'Options'
dat.GUI.TEXT_CLOSED = 'Options'
const gui = new dat.GUI({ width: 400 })

window.addEventListener('keydown', (e) => {
  if (e.key === '`') {
    if (gui.closed) gui.open()
    else gui.close()
  }
})

const NAME_COLORS = ['Red', 'Blue', 'Pink', 'Gold', 'Lime', 'Cyan', 'Teal', 'Jade', 'Ruby', 'Amber', 'Coral', 'Plum', 'Mint', 'Navy', 'Sage', 'Peach', 'Olive', 'Rust', 'Onyx', 'Snow', 'Wine', 'Moss', 'Sand', 'Coal', 'Ink', 'Fog', 'Ice', 'Ash', 'Neon', 'Volt', 'Aqua']
const NAME_NOUNS = ['Fox', 'Wolf', 'Bear', 'Cat', 'Owl', 'Bat', 'Elk', 'Hawk', 'Lynx', 'Crow', 'Kiwi', 'Pear', 'Fig', 'Plum', 'Date', 'Moth', 'Crab', 'Puma', 'Mink', 'Dove', 'Seal', 'Toad', 'Wren', 'Finch', 'Grape', 'Melon', 'Mango', 'Apple', 'Lemon', 'Berry', 'Acorn', 'Tiger', 'Moose', 'Goat', 'Duck', 'Frog', 'Deer', 'Hare', 'Boar']

function generateDefaultPlayerName() {
  const color = NAME_COLORS[Math.floor(Math.random() * NAME_COLORS.length)]
  const noun = NAME_NOUNS[Math.floor(Math.random() * NAME_NOUNS.length)]
  return color + noun
}

function loadPlayerName() {
  let name = localStorage.getItem('playerName')
  if (!name) {
    name = generateDefaultPlayerName()
    localStorage.setItem('playerName', name)
  }
  return name.length > 12 ? name.substring(0, 12) : name
}

// Inputs consumed by controls.js / the main loop
const inputControls = {
  steering: 0,
  throttle: 0,
  brake: 0,
  handbrake: 0,
  enabled: false,
}

// Player identity (used by Vehicle.serialize / networking)
const playerControl = {
  name: loadPlayerName()
}

const params = {
  car_id: localStorage.getItem('car_id') || 'mustang',
  skipIntro: false,
  offlinePlay: localStorage.getItem('offlinePlay') === 'true',
  updateCamera: true,
  analogControls: true,
  tractionControl: false,
  tcSlipLimit: 0.25,
  tcStrength: 2,
  tcMaxCut: 0.75,
  spinPrevention: true,
  spinAssist: 0.5,
  steeringAssist: true,
  steerAssistGain: 0.6,
  steerAssistSlipLimitDeg: 10,
  wheelInertia: 1.2,
  engineTorque: 700,
  drivetrainEngineInertia: 1,
  engineFrictionNm: 25,
  engineViscousFriction: 0.08,
  converterStallRatio: 0.35,
  shiftLoadMultiplier: 1.5,
  shiftDuration: 0.5,
  brakeTorque: 450,
  tireLongitudinalStiffness: 12,
  tireLateralStiffness: 2,
  tireSlipDamping: 450,
  maxWheelAngularVelocity: 220,
  throttleInput: 0,
  autoThrottle: 0,
  runPhysics: true,
  physicsDebug: false,
  autoStopPhysicsAfterSec: 0,
  debugSpawnU: -1,
  debugSpawnBackM: 30,
  spawnAngle: 0,
  botShader: 'xray',
  botOutlineThickness: 0.02,
  smokeEnabled: true,
  smokeSlipThreshold: 0.25,
  smokeRate: 45,
  maxSmokeParticles: 160,
  playerName: playerControl.name,
  soundVolume: 50,
  explosionEnabled: true,
  explosionForceThreshold: 50,
  explodeGSmoothing: 0.25,
  carMaxHp: 100,
  damageGMin: 8,
  damageHpPerG: 3.125,
  respawnDelay: 1000,
  particleCount: 100,
  portalEnabled: true,
  recordLaps: true,
  numLaps: Number(localStorage.getItem('numLaps')) || 5,
  botDrive: true,
  numBots: localStorage.getItem('numBots') !== null ? Number(localStorage.getItem('numBots')) : 4,
  carCollisionEnabled: true,
  carCollisionSpeedDiffThreshold: 0.2,
  carCollisionSameDirDot: 0.5,
  autoSteer: false,
  autoSteerStrength: 1.35,
  botLookahead: 3.5,
  botLookaheadTime: 0,
  botSteerGain: 1.2,
  botMaxSteer: 1,
  botSteerRate: 0.15,
  botMaxOffset: 10,
  botMaxSpeed: 180,
  botMaxLatAccel: 12,
  botCurvatureSpacing: 10,
  tiltSteering: (() => {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const savedValue = localStorage.getItem('tiltSteering');
    return savedValue !== null ? savedValue === 'true' : isMobile;
  })()
}

let playerNameController

function applyPlayerName(name) {
  name = String(name || '').trim()
  if (!name) name = generateDefaultPlayerName()
  if (name.length > 12) name = name.substring(0, 12)
  playerControl.name = name
  params.playerName = name
  localStorage.setItem('playerName', name)
  playerNameController?.updateDisplay()
  const nameInput = document.getElementById('player-name-input')
  if (nameInput && nameInput.value !== name) nameInput.value = name
  return name
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
  frontSlipAngle: 0,
  steerAssistActive: false,
  steerAssistCorrection: 0,
  autoSteerAssist: 0,
  autoSteerLateral: 0,
  autoSteerHeadingDeg: 0,
  crashG: 0,
  converterTorque: 0,
}

const carCollisionDebug = {
  overlapping: false,
  speedA: 0,
  speedB: 0,
  speedDiff: 0,
  fwdDot: 0,
  depth: 0,
  branch: 'none',
}

gui.useLocalStorage = true
gui.remember(params)

playerNameController = gui.add(params, 'playerName').name('Player Name').onChange(applyPlayerName)
gui.add(params, 'botShader', ['none', 'outline', 'fresnel', 'solid', 'xray', 'digital', 'glitch', 'waves']).onChange(() => window.refreshBotShader?.())
gui.add(params, 'botOutlineThickness', 0.005, 0.06).step(0.001).onChange(() => window.refreshBotShader?.())
gui.add(params, 'smokeEnabled')
const soundVolumeController = gui.add(params, 'soundVolume', 0, 100).step(1)
gui.add(vehicleParams, 'steeringSensitivity', 0.1, 2.0).step(0.1)

const stabilityFolder = gui.addFolder('Driving Assist')
const tcController = stabilityFolder.add(params, 'tractionControl')
stabilityFolder.add(params, 'tcSlipLimit', 0, 1).step(0.01)
stabilityFolder.add(params, 'tcStrength', 0, 10).step(0.1)
stabilityFolder.add(params, 'tcMaxCut', 0, 1).step(0.01)
const spinPreventionController = stabilityFolder.add(params, 'spinPrevention')
stabilityFolder.add(params, 'spinAssist', 0, 1).step(0.25)
const steeringAssistController = stabilityFolder.add(params, 'steeringAssist')
stabilityFolder.add(params, 'steerAssistSlipLimitDeg', 2, 25).step(0.5)
stabilityFolder.add(params, 'steerAssistGain', 0, 2).step(0.05)
const autoSteerController = stabilityFolder.add(params, 'autoSteer')
stabilityFolder.add(params, 'autoSteerStrength', 0, 2).step(0.05)
stabilityFolder.add(vehicleParams, 'autoSteerAssist', 0, 1).step(0.01).listen()
stabilityFolder.add(vehicleParams, 'autoSteerLateral', -15, 15).step(0.1).listen()
stabilityFolder.add(vehicleParams, 'autoSteerHeadingDeg', -45, 45).step(0.1).listen()

const drivetrainFolder = gui.addFolder('Drivetrain')
drivetrainFolder.add(params, 'drivetrainEngineInertia', 0.1, 5).step(0.1)
drivetrainFolder.add(params, 'engineFrictionNm', 0, 200).step(1)
drivetrainFolder.add(params, 'engineViscousFriction', 0, 0.5).step(0.01)
drivetrainFolder.add(params, 'converterStallRatio', 0.1, 0.8).step(0.01)
drivetrainFolder.add(params, 'shiftLoadMultiplier', 0, 5).step(0.1)
drivetrainFolder.add(params, 'shiftDuration', 0.1, 2).step(0.05)
drivetrainFolder.add(vehicleParams, 'converterTorque', -2000, 2000).step(1).listen()

const botFolder = gui.addFolder('Bot')
botFolder.add(params, 'numBots', 0, 20).step(1)
botFolder.add(params, 'botDrive')
botFolder.add(params, 'botLookahead', 1, 40).step(0.5)
botFolder.add(params, 'botLookaheadTime', 0, 1).step(0.05)
botFolder.add(params, 'botSteerGain', 0, 5).step(0.1)
botFolder.add(params, 'botMaxSteer', 0.1, 1).step(0.05)
botFolder.add(params, 'botSteerRate', 0.01, 0.5).step(0.01)
botFolder.add(params, 'botMaxOffset', 1, 30).step(1)
botFolder.add(params, 'botMaxSpeed', 20, 250).step(10)
botFolder.add(params, 'botMaxLatAccel', 4, 25).step(0.5)
botFolder.add(params, 'botCurvatureSpacing', 3, 25).step(1)

const carCollisionFolder = gui.addFolder('Car Collision')
carCollisionFolder.add(params, 'carCollisionEnabled')
carCollisionFolder.add(params, 'carCollisionSpeedDiffThreshold', 0, 1).step(0.01)
carCollisionFolder.add(params, 'carCollisionSameDirDot', 0, 1).step(0.05)
carCollisionFolder.add(carCollisionDebug, 'overlapping').listen()
carCollisionFolder.add(carCollisionDebug, 'speedA', -200, 200).step(0.1).listen()
carCollisionFolder.add(carCollisionDebug, 'speedB', -200, 200).step(0.1).listen()
carCollisionFolder.add(carCollisionDebug, 'speedDiff', 0, 1).step(0.001).listen()
carCollisionFolder.add(carCollisionDebug, 'fwdDot', -1, 1).step(0.01).listen()
carCollisionFolder.add(carCollisionDebug, 'depth', 0, 1).step(0.001).listen()
carCollisionFolder.add(carCollisionDebug, 'branch', ['none', 'speedDiffGray', 'oppositeDirSkip', 'softPushRear']).listen()

const debugFolder = gui.addFolder('Debug')
debugFolder.add(params, 'explosionEnabled')
debugFolder.add(params, 'explodeGSmoothing', 0.02, 1).step(0.01)
debugFolder.add(params, 'carMaxHp', 10, 500).step(10)
debugFolder.add(params, 'damageGMin', 0, 16).step(0.5)
debugFolder.add(params, 'damageHpPerG', 0.5, 15).step(0.125)
debugFolder.add(vehicleParams, 'crashG', 0, 20).step(0.1).listen()
debugFolder.add(params, 'recordLaps')
debugFolder.add(params, 'throttleInput', -1, 1).step(0.01)
debugFolder.add(params, 'autoThrottle', 0, 1).step(0.05)
debugFolder.add(params, 'runPhysics')
debugFolder.add(params, 'physicsDebug').onChange((enabled) => window.setPhysicsDebug?.(enabled))
debugFolder.add(params, 'autoStopPhysicsAfterSec')
debugFolder.add(params, 'debugSpawnU', -1, 1).step(0.01).name('Spawn u (-1=start)')
debugFolder.add(params, 'debugSpawnBackM', 0, 150).step(5).name('Spawn back m')
debugFolder.add(params, 'spawnAngle', -180, 180).step(1).name('Spawn angle °')
debugFolder.add(vehicleParams, 'wheelSpeed', -50, 50).step(0.1).listen()
debugFolder.add(vehicleParams, 'slipRatio', -1, 1).step(0.01).listen()
debugFolder.add(vehicleParams, 'slipAngle', -90, 90).step(0.1).listen()
debugFolder.add(vehicleParams, 'frontSlipAngle', 0, 25).step(0.1).listen()
debugFolder.add(vehicleParams, 'steerAssistCorrection', -0.3, 0.3).step(0.01).listen()
debugFolder.add(vehicleParams, 'steerAssistActive').listen()
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
applyPlayerName(new URLSearchParams(window.location.search).has('playerName') ? params.playerName : playerControl.name)

const tcToggleInput = document.getElementById('tc-toggle-input')
const autoSteerToggleInput = document.getElementById('auto-steer-toggle-input')
const hudToast = document.getElementById('hud-toast')
const soundToggleInput = document.getElementById('sound-toggle-input')
const soundToggleLabel = document.querySelector('#sound-toggle .v-toggle-label')
let toastTimeoutId = null
let clickCtx = null
let savedSoundVolume = params.soundVolume > 0 ? params.soundVolume : 50
let soundMuted = params.soundVolume === 0

function syncSoundToggle() {
  if (!soundToggleInput) return
  soundToggleInput.checked = !soundMuted
  if (soundToggleLabel) soundToggleLabel.textContent = soundMuted ? '🔇' : '🔊'
}

function setSoundMuted(muted) {
  soundMuted = muted
  if (muted) {
    if (params.soundVolume > 0) savedSoundVolume = params.soundVolume
    params.soundVolume = 0
  } else {
    params.soundVolume = savedSoundVolume || 50
  }
  soundVolumeController.updateDisplay()
  syncSoundToggle()
}

if (soundToggleInput) {
  syncSoundToggle()
  soundToggleInput.addEventListener('change', () => {
    setSoundMuted(!soundToggleInput.checked)
    if (!soundMuted) playToggleClick()
    releaseToggleFocus(soundToggleInput)
  })
}
soundVolumeController.onChange((value) => {
  if (value === 0) {
    soundMuted = true
  } else {
    soundMuted = false
    savedSoundVolume = value
  }
  syncSoundToggle()
})

function playToggleClick() {
  if (soundMuted) return
  clickCtx ||= new AudioContext()
  if (clickCtx.state === 'suspended') clickCtx.resume()
  const t = clickCtx.currentTime
  const osc = clickCtx.createOscillator()
  const gain = clickCtx.createGain()
  osc.type = 'square'
  osc.frequency.setValueAtTime(2200, t)
  osc.frequency.exponentialRampToValueAtTime(700, t + 0.025)
  gain.gain.setValueAtTime(0.12, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.045)
  osc.connect(gain)
  gain.connect(clickCtx.destination)
  osc.start(t)
  osc.stop(t + 0.05)
}

function showHudToast(message) {
  hudToast.textContent = message
  hudToast.classList.add('show')
  clearTimeout(toastTimeoutId)
  toastTimeoutId = setTimeout(() => hudToast.classList.remove('show'), 900)
}

function driverAidsEnabled() {
  // tractionControl is too restrictive — keep it off the TC HUD switch
  return params.spinPrevention && params.steeringAssist
}

function setDriverAids(enabled) {
  // tractionControl is too restrictive — keep it off the TC HUD switch
  params.spinPrevention = enabled
  params.steeringAssist = enabled
  spinPreventionController.updateDisplay()
  steeringAssistController.updateDisplay()
}

function syncDriverAidsToggle() {
  tcToggleInput.checked = driverAidsEnabled()
}

function releaseToggleFocus(input) {
  input.blur()
  input.closest('label')?.blur()
}

tcToggleInput.checked = driverAidsEnabled()
tcToggleInput.addEventListener('change', () => {
  setDriverAids(tcToggleInput.checked)
  playToggleClick()
  showHudToast(tcToggleInput.checked ? 'Driver Aids ON' : 'Driver Aids OFF')
  releaseToggleFocus(tcToggleInput)
})
tcController.onChange(syncDriverAidsToggle)
spinPreventionController.onChange(syncDriverAidsToggle)
steeringAssistController.onChange(syncDriverAidsToggle)

autoSteerToggleInput.checked = params.autoSteer
autoSteerToggleInput.addEventListener('change', () => {
  params.autoSteer = autoSteerToggleInput.checked
  autoSteerController.updateDisplay()
  playToggleClick()
  showHudToast(autoSteerToggleInput.checked ? 'Auto Steer ON' : 'Auto Steer OFF')
  releaseToggleFocus(autoSteerToggleInput)
})
autoSteerController.onChange((enabled) => {
  autoSteerToggleInput.checked = enabled
})

gui.close()

window.bindCameraSwitcherToGui = () => {}
