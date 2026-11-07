import { on, off } from './raceEvents.js'

const POSE_FLOATS = 7 + 4 * 7
const WHEEL_COUNT = 4
const CF_KINEMATIC_OBJECT = 2
const DISABLE_DEACTIVATION = 4
const LAST_REPLAY_STORAGE_KEY = 'boxracing.lastReplay'

const _qa = new THREE.Quaternion()
const _qb = new THREE.Quaternion()
const _qt = new THREE.Quaternion()
const _pos = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _pose = new Float32Array(POSE_FLOATS)

function writePose(vehicle, out) {
  const root = vehicle.visualRoot
  out[0] = root.position.x
  out[1] = root.position.y
  out[2] = root.position.z
  out[3] = root.quaternion.x
  out[4] = root.quaternion.y
  out[5] = root.quaternion.z
  out[6] = root.quaternion.w
  for (let i = 0; i < WHEEL_COUNT; i++) {
    const wheel = vehicle.wheelMeshes[i]
    const o = 7 + i * 7
    out[o] = wheel.position.x
    out[o + 1] = wheel.position.y
    out[o + 2] = wheel.position.z
    out[o + 3] = wheel.quaternion.x
    out[o + 4] = wheel.quaternion.y
    out[o + 5] = wheel.quaternion.z
    out[o + 6] = wheel.quaternion.w
  }
}

function lerpPose(a, b, alpha, out) {
  for (let part = 0; part < 5; part++) {
    const o = part * 7
    out[o] = a[o] + (b[o] - a[o]) * alpha
    out[o + 1] = a[o + 1] + (b[o + 1] - a[o + 1]) * alpha
    out[o + 2] = a[o + 2] + (b[o + 2] - a[o + 2]) * alpha
    _qa.set(a[o + 3], a[o + 4], a[o + 5], a[o + 6])
    _qb.set(b[o + 3], b[o + 4], b[o + 5], b[o + 6])
    _qt.slerpQuaternions(_qa, _qb, alpha)
    out[o + 3] = _qt.x
    out[o + 4] = _qt.y
    out[o + 5] = _qt.z
    out[o + 6] = _qt.w
  }
}

function applyPose(vehicle, pose, btQuat) {
  _pos.set(pose[0], pose[1], pose[2])
  _quat.set(pose[3], pose[4], pose[5], pose[6])
  vehicle.syncBodyTransform(_pos, _quat)

  const ammoBody = vehicle.chassis.body.ammo
  const transform = ammoBody.getWorldTransform()
  transform.getOrigin().setValue(pose[0], pose[1], pose[2])
  btQuat.setValue(pose[3], pose[4], pose[5], pose[6])
  transform.setRotation(btQuat)
  ammoBody.setWorldTransform(transform)

  for (let i = 0; i < WHEEL_COUNT; i++) {
    const o = 7 + i * 7
    const wheel = vehicle.wheelMeshes[i]
    wheel.position.set(pose[o], pose[o + 1], pose[o + 2])
    wheel.quaternion.set(pose[o + 3], pose[o + 4], pose[o + 5], pose[o + 6])
  }
}

function formatReplayTime(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function pickRecorderMime() {
  const types = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ]
  return types.find(type => MediaRecorder.isTypeSupported(type))
}

class Replay {
  constructor(scene) {
    this.scene = scene
    this.recording = false
    this.active = false
    this.playing = false
    this.exporting = false
    this.origin = 0
    this.time = 0
    this.speed = Number(params.replaySpeed) > 0 ? Number(params.replaySpeed) : 1
    this.loop = Boolean(params.replayLoop)
    this.targetCarIndex = 0
    this.times = []
    this.tracks = []
    this._playTimeout = 0
    this._exportDone = null
    this._stopAfterCapture = false
    this._btZero = null
    this._btQuat = null

    this.overlay = document.getElementById('replay-overlay')
    this.badge = document.getElementById('replay-badge')
    this.playBtn = document.getElementById('replay-play')
    this.timeline = document.getElementById('replay-timeline')
    this.timeLabel = document.getElementById('replay-time')
    this.speedSelect = document.getElementById('replay-speed')
    this.carSelect = document.getElementById('replay-car')
    this.cameraSelect = document.getElementById('replay-camera')
    this.saveBtn = document.getElementById('replay-save')
    this.loadBtn = document.getElementById('replay-load')
    this.fileInput = document.getElementById('replay-file-input')
    this.screenshotBtn = document.getElementById('replay-screenshot')
    this.exportBtn = document.getElementById('replay-export')
    this.closeBtn = document.getElementById('replay-close')
    if (!this.overlay) throw new Error('replay-overlay element missing')

    this.scene.cameraSwitcher.controllers.forEach((controller, index) => {
      const option = document.createElement('option')
      option.value = String(index)
      option.textContent = controller.label
      this.cameraSelect.appendChild(option)
    })

    this.refreshCarOptions()

    this.playBtn.addEventListener('click', () => this.togglePlay())
    this.screenshotBtn.addEventListener('click', () => this.screenshot())
    this.exportBtn.addEventListener('click', () => this.exportVideo())
    this.closeBtn.addEventListener('click', () => this.exit())
    this.saveBtn?.addEventListener('click', () => this.downloadJson())
    this.loadBtn?.addEventListener('click', () => this.fileInput?.click())
    this.fileInput?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0]
      if (!file) return
      const text = await file.text()
      this.loadJSON(JSON.parse(text))
      this.enter()
      e.target.value = ''
    })
    this.cameraSelect.addEventListener('change', () => {
      if (!this.exporting) this.setCamera(Number(this.cameraSelect.value))
    })
    this.carSelect?.addEventListener('change', () => {
      if (!this.exporting) this.setTargetCar(Number(this.carSelect.value))
    })
    this.speedSelect?.addEventListener('change', () => {
      this.setSpeed(Number(this.speedSelect.value))
    })
    this.timeline.addEventListener('pointerdown', () => {
      if (!this.exporting) this.pause()
    })
    this.timeline.addEventListener('input', () => {
      if (this.exporting) return
      this.seek(Number(this.timeline.value))
    })
    this._onKeyDown = (e) => {
      if (!this.active || this.exporting || e.repeat) return
      if (e.target?.closest?.('input, button, select, textarea')) return
      if (e.code === 'Space') {
        e.preventDefault()
        this.togglePlay()
      } else if (e.code === 'BracketRight' || e.code === 'KeyN') {
        this.setTargetCar((this.targetCarIndex + 1) % Math.max(1, this.vehicles().length))
      } else if (e.code === 'BracketLeft' || e.code === 'KeyP') {
        const count = Math.max(1, this.vehicles().length)
        this.setTargetCar((this.targetCarIndex - 1 + count) % count)
      }
    }
    window.addEventListener('keydown', this._onKeyDown)

    this._onRaceStart = () => this.startRecording()
    on('raceStart', this._onRaceStart)

    window.__replay = this
    window.downloadReplay = (filename) => this.downloadJson(filename)
  }

  vehicles() {
    return [this.scene.car, ...(this.scene.bots ?? []).map(entry => entry.car)].filter(Boolean)
  }

  vehicleMeta(vehicle, index) {
    const racer = this.scene.checkpointManager?.racerForChassis(vehicle.chassis)
    const trackMeta = this.tracks[index]
    return {
      index,
      name: trackMeta?.name || racer?.name || (index === 0 ? 'Player' : `Bot ${index}`),
      carId: trackMeta?.carId || vehicle.car_id || 'mustang',
      isPlayer: index === 0,
    }
  }

  refreshCarOptions() {
    if (!this.carSelect) return
    this.carSelect.replaceChildren()
    this.vehicles().forEach((vehicle, index) => {
      const meta = this.vehicleMeta(vehicle, index)
      const option = document.createElement('option')
      option.value = String(index)
      option.textContent = `${index + 1}. ${meta.name}`
      this.carSelect.appendChild(option)
    })
    this.carSelect.value = String(this.targetCarIndex)
  }

  targetVehicle() {
    const list = this.vehicles()
    return list[this.targetCarIndex] ?? list[0] ?? this.scene.car
  }

  targetRoot() {
    return this.targetVehicle()?.visualRoot ?? this.scene.car?.visualRoot ?? null
  }

  resolveCarIndex(indexOrName) {
    const list = this.vehicles()
    if (!list.length) return 0
    if (typeof indexOrName === 'number' && Number.isFinite(indexOrName)) {
      return Math.max(0, Math.min(list.length - 1, Math.trunc(indexOrName)))
    }
    const raw = String(indexOrName ?? '').trim().toLowerCase()
    if (!raw) return this.targetCarIndex
    if (/^\d+$/.test(raw)) {
      return Math.max(0, Math.min(list.length - 1, Number(raw)))
    }
    if (raw === 'player' || raw === 'me') return 0
    const botMatch = raw.match(/^bot\s*(\d+)$/)
    if (botMatch) {
      return Math.max(0, Math.min(list.length - 1, Number(botMatch[1])))
    }
    const found = list.findIndex((v, i) => {
      const meta = this.vehicleMeta(v, i)
      return meta.name.toLowerCase().includes(raw) || meta.carId.toLowerCase() === raw
    })
    return found >= 0 ? found : this.targetCarIndex
  }

  renderImmediate() {
    if (!this.active) return
    const root = this.targetRoot()
    if (root) {
      if (this.time > 20) {
        this.applyAt(this.time - 16.67)
      }
      this.scene.cameraSwitcher._lastTarget = root
      this.scene.cameraSwitcher._activeController?.activate?.(this.scene.camera, root)
      this.applyAt(this.time)
      this.scene.updateCamera(1 / 60)
    }
    this.scene.renderer?.render(this.scene.scene, this.scene.camera)
  }

  setTargetCar(indexOrName) {
    this.targetCarIndex = this.resolveCarIndex(indexOrName)
    this.renderImmediate()
    this.syncUi()
    return this.vehicleMeta(this.targetVehicle(), this.targetCarIndex)
  }

  setCamera(idOrIndex) {
    this.scene.cameraSwitcher.setController(idOrIndex)
    this.renderImmediate()
    this.syncUi()
    const ctrl = this.scene.cameraSwitcher._activeController
    return { index: this.scene.cameraSwitcher._activeIndex, id: ctrl?.id, label: ctrl?.label }
  }

  setSpeed(multiplier) {
    const n = Number(multiplier)
    if (Number.isFinite(n) && n > 0) {
      this.speed = n
    }
    this.syncUi()
    return this.speed
  }

  listCameras() {
    return this.scene.cameraSwitcher.controllers.map((c, index) => ({
      index,
      id: c.id || String(index),
      label: c.label,
    }))
  }

  listCars() {
    return this.vehicles().map((v, i) => this.vehicleMeta(v, i))
  }

  status() {
    const ctrl = this.scene.cameraSwitcher._activeController
    return {
      active: this.active,
      playing: this.playing,
      recording: this.recording,
      exporting: this.exporting,
      time: Math.round(this.time),
      duration: Math.round(this.duration()),
      frames: this.times.length,
      speed: this.speed,
      loop: this.loop,
      camera: { index: this.scene.cameraSwitcher._activeIndex, id: ctrl?.id, label: ctrl?.label },
      targetCar: this.vehicleMeta(this.targetVehicle(), this.targetCarIndex),
    }
  }

  duration() {
    return this.times.length ? this.times[this.times.length - 1] : 0
  }

  ensureAmmo() {
    if (this._btZero) return
    this._btZero = new Ammo.btVector3(0, 0, 0)
    this._btQuat = new Ammo.btQuaternion(0, 0, 0, 1)
  }

  startRecording() {
    this.resetForNextRace()
    this.times = []
    this.tracks = this.vehicles().map((vehicle, index) => {
      const meta = this.vehicleMeta(vehicle, index)
      return {
        vehicle,
        name: meta.name,
        carId: meta.carId,
        isPlayer: meta.isPlayer,
        poses: [],
      }
    })
    this.refreshCarOptions()
    this.origin = performance.now()
    this.recordTime = 0
    this.recording = true
    this._stopAfterCapture = false
  }

  capture(deltaMs = 16.67) {
    if (!this.tracks.length) return
    if (this.times.length > 0) {
      this.recordTime += Math.max(1, Math.min(100, Number(deltaMs) || 16.67))
    } else {
      this.recordTime = 0
    }
    this.times.push(this.recordTime)
    for (const track of this.tracks) {
      const pose = new Float32Array(POSE_FLOATS)
      writePose(track.vehicle, pose)
      track.poses.push(pose)
    }
  }

  recordFrame(deltaMs = this.scene?._deltaTime || 16.67) {
    if (!this.recording || this.active) return
    this.capture(deltaMs)
    if (this._stopAfterCapture) {
      this.recording = false
      this._stopAfterCapture = false
      this.saveLastReplay()
      if (params.autosaveReplay) {
        this.downloadJson()
      }
    }
  }

  recordSimulation(seconds = 10, fps = 60) {
    const dtMs = 1000 / fps
    const totalFrames = Math.max(1, Math.round(seconds * fps))
    const savedAutoStop = params.autoStopPhysicsAfterSec
    params.autoStopPhysicsAfterSec = 0
    try {
      params.runPhysics = true
      this.startRecording()
      const allVehicles = this.vehicles()
      for (let f = 0; f < totalFrames; f++) {
        const tSec = ((f + 1) * dtMs) / 1000
        for (const v of allVehicles) {
          const gb = v.gearbox
          if (gb?.shiftTimeout) {
            v._simShiftMs = (v._simShiftMs || 0) + dtMs
            if (v._simShiftMs >= (gb.activeShiftDuration || 0.5) * 1000) {
              clearTimeout(gb.shiftTimeout)
              gb.shiftTimeout = null
              v._simShiftMs = 0
            }
          } else {
            v._simShiftMs = 0
          }
          if (gb?.limiterTimeout) {
            clearTimeout(gb.limiterTimeout)
            gb.limiterTimeout = null
          }
        }
        this.scene._deltaTime = dtMs
        this.scene.update(tSec, dtMs)
        this.scene.physics?.update(dtMs)
        if (this.scene.car) this.scene.car.syncVisualTransforms()
        for (const { car } of this.scene.bots ?? []) car.syncVisualTransforms()
        this.scene.carCollisionManager?.postPhysicsUpdate(dtMs / 1000)
        this.capture(dtMs)
        if (this.scene.checkpointManager?.raceFinished) break
      }
      this.recording = false
      this._stopAfterCapture = false
      this.saveLastReplay()
      if (params.autosaveReplay) {
        this.downloadJson()
      }
      return this.status()
    } finally {
      params.autoStopPhysicsAfterSec = savedAutoStop
    }
  }

  onPlayerFinished() {
    this._stopAfterCapture = true
    clearTimeout(this._playTimeout)
    this._playTimeout = setTimeout(() => this.enterFromParams(), 2500)
  }

  onAutoStop() {
    if (this.recording) {
      this.capture()
      this.recording = false
      this._stopAfterCapture = false
    }
    if (this.times.length > 0) {
      this.saveLastReplay()
      if (params.autosaveReplay) {
        this.downloadJson()
      }
      if (params.replay || params.replayCam || params.replayCar || params.replayTime >= 0 || params.replayExport) {
        this.enterFromParams()
      }
    }
  }

  toJSON() {
    return {
      version: 1,
      recordedAt: new Date().toISOString(),
      duration: Math.round(this.duration()),
      times: this.times.map(t => Math.round(t * 10) / 10),
      tracks: this.tracks.map((track, index) => {
        const meta = this.vehicleMeta(track.vehicle, index)
        return {
          name: track.name || meta.name,
          carId: track.carId || meta.carId,
          isPlayer: index === 0,
          poses: track.poses.map(pose => Array.from(pose, v => Math.round(v * 1000) / 1000)),
        }
      }),
    }
  }

  loadJSON(data) {
    if (!data || !Array.isArray(data.times) || !Array.isArray(data.tracks)) {
      throw new Error('Invalid replay JSON format')
    }
    const list = this.vehicles()
    this.times = data.times.map(Number)
    this.tracks = data.tracks.slice(0, list.length).map((trackData, index) => {
      const vehicle = list[index]
      const racer = this.scene.checkpointManager?.racerForChassis(vehicle.chassis)
      if (racer && trackData.name) racer.name = trackData.name
      return {
        vehicle,
        name: trackData.name || (index === 0 ? 'Player' : `Bot ${index}`),
        carId: trackData.carId || vehicle.car_id || 'mustang',
        isPlayer: index === 0,
        poses: trackData.poses.map(arr => new Float32Array(arr)),
      }
    })
    this.recording = false
    this._stopAfterCapture = false
    this.refreshCarOptions()
    return this.status()
  }

  async loadUrl(url) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch replay from ${url}: ${res.status}`)
    const data = await res.json()
    return this.loadJSON(data)
  }

  saveLastReplay() {
    if (!this.times.length) return null
    const data = this.toJSON()
    window.__lastReplayJson = data
    const serialized = JSON.stringify(data)
    if (serialized.length < 4_500_000) {
      localStorage.setItem(LAST_REPLAY_STORAGE_KEY, serialized)
    }
    return data
  }

  downloadJson(filename = `boxracing-replay-${Date.now()}.json`) {
    if (!this.times.length) return null
    const data = this.saveLastReplay() ?? this.toJSON()
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    downloadBlob(blob, filename)
    return data
  }

  enterFromParams() {
    this.enter({
      camera: params.replayCam || 'follow',
      car: params.replayCar || 0,
      time: params.replayTime,
      speed: params.replaySpeed,
      playing: params.replayPlaying,
      loop: params.replayLoop,
      exportVideo: params.replayExport,
    })
  }

  enter(options = {}) {
    if (this.active) return this.status()
    if (this.times.length === 0) {
      const toast = document.getElementById('hud-toast')
      toast.textContent = 'Replay starts when the race begins'
      toast.classList.add('show')
      setTimeout(() => toast.classList.remove('show'), 2000)
      return this.status()
    }
    this._liveSnapshot = this.scene.checkpointManager.raceFinished ? null : {
      at: performance.now(),
      runPhysics: params.runPhysics,
      recording: this.recording,
      vehicles: this.vehicles().map(vehicle => {
        const pose = new Float32Array(POSE_FLOATS)
        writePose(vehicle, pose)
        const body = vehicle.chassis.body.ammo
        const linear = body.getLinearVelocity()
        const angular = body.getAngularVelocity()
        return {
          vehicle, pose,
          linear: [linear.x(), linear.y(), linear.z()],
          angular: [angular.x(), angular.y(), angular.z()],
        }
      }),
    }
    this.recording = false
    clearTimeout(this._playTimeout)
    this.active = true
    this._cameraBeforeReplay = this.scene.cameraSwitcher._activeIndex
    params.runPhysics = false
    this.freezeAll()
    this.silenceAll()
    this.scene.checkpointManager.finishElement.classList.remove('visible')
    document.body.classList.add('replay-playing')
    this.overlay.classList.add('visible')
    this.refreshCarOptions()

    if (options.speed !== undefined && Number(options.speed) > 0) {
      this.speed = Number(options.speed)
    }
    if (options.loop !== undefined) {
      this.loop = Boolean(options.loop)
    }

    const initialCar = options.car !== undefined && options.car !== '' ? options.car : this.targetCarIndex
    this.targetCarIndex = this.resolveCarIndex(initialCar)

    let initialTimeMs = 0
    if (options.time !== undefined && Number(options.time) >= 0) {
      const rawTime = Number(options.time)
      initialTimeMs = rawTime <= this.duration() / 1000 ? rawTime * 1000 : rawTime
    }
    this.seek(initialTimeMs)

    const initialCamera = options.camera !== undefined && options.camera !== '' ? options.camera : 0
    this.setCamera(initialCamera)

    this.playing = options.playing !== undefined ? Boolean(options.playing) : true
    this.syncUi()

    if (options.exportVideo) {
      this.exportVideo()
    }
    return this.status()
  }

  exit() {
    if (!this.active || this.exporting) return
    this.playing = false
    if (this._liveSnapshot) {
      const snapshot = this._liveSnapshot
      const elapsed = performance.now() - snapshot.at
      this.ensureAmmo()
      for (const state of snapshot.vehicles) {
        applyPose(state.vehicle, state.pose, this._btQuat)
        const body = state.vehicle.chassis.body.ammo
        const linear = new Ammo.btVector3(...state.linear)
        const angular = new Ammo.btVector3(...state.angular)
        body.setLinearVelocity(linear)
        body.setAngularVelocity(angular)
        Ammo.destroy(linear)
        Ammo.destroy(angular)
      }
      this.origin += elapsed
      const manager = this.scene.checkpointManager
      for (const key of ['raceStartTime', 'currentLapStartTime']) {
        if (manager[key]) manager[key] += elapsed
      }
      for (const racer of manager.racers) {
        if (racer.lapStartTime) racer.lapStartTime += elapsed
        if (racer.finishTime) racer.finishTime += elapsed
        racer.splitTimes = racer.splitTimes.map(time => time + elapsed)
      }
      params.runPhysics = snapshot.runPhysics
      this.recording = snapshot.recording
      this._liveSnapshot = null
    } else {
      this.seek(this.duration())
      this.scene.checkpointManager.finishElement.classList.add('visible')
    }
    this.restorePhysics()
    if (this.recording) {
      for (const vehicle of this.vehicles()) vehicle.chassis.body.ammo.activate()
    }
    this.active = false
    this.scene.cameraSwitcher.setController(this._cameraBeforeReplay)
    document.body.classList.remove('replay-playing')
    this.overlay.classList.remove('visible')
  }

  freezeAll() {
    this.ensureAmmo()
    for (const vehicle of this.vehicles()) {
      const ammoBody = vehicle.chassis.body.ammo
      if (vehicle._replayCollisionFlags === undefined) {
        vehicle._replayCollisionFlags = ammoBody.getCollisionFlags()
        ammoBody.setCollisionFlags(vehicle._replayCollisionFlags | CF_KINEMATIC_OBJECT)
        ammoBody.setActivationState(DISABLE_DEACTIVATION)
      }
      ammoBody.setLinearVelocity(this._btZero)
      ammoBody.setAngularVelocity(this._btZero)
    }
  }

  resetForNextRace() {
    clearTimeout(this._playTimeout)
    this.playing = false
    this.active = false
    this._liveSnapshot = null
    document.body.classList.remove('replay-playing')
    this.overlay.classList.remove('visible')
    this.restorePhysics()
    params.runPhysics = true
  }

  restorePhysics() {
    for (const vehicle of this.vehicles()) {
      if (vehicle._replayCollisionFlags === undefined) continue
      const body = vehicle.chassis.body.ammo
      body.setCollisionFlags(vehicle._replayCollisionFlags)
      body.setActivationState(1)
      body.activate()
      delete vehicle._replayCollisionFlags
    }
  }

  silenceAll() {
    for (const vehicle of this.vehicles()) {
      vehicle.collisionMesh.engineSound?.setVolume(0)
      vehicle.particles?.tireSound?.update(0, 1)
    }
  }

  togglePlay() {
    if (!this.active || this.exporting) return
    if (this.playing) this.pause()
    else this.play()
  }

  play() {
    if (!this.active || this.times.length === 0) return
    if (this.time >= this.duration()) {
      this.time = 0
      const root = this.targetRoot()
      if (root) this.scene.cameraSwitcher._activeController?.activate?.(this.scene.camera, root)
    }
    this.playing = true
    this.applyAt(this.time)
    this.syncUi()
  }

  pause() {
    this.playing = false
    this.syncUi()
  }

  seek(ms) {
    this.time = Math.max(0, Math.min(this.duration(), ms))
    this.applyAt(this.time)
    this.renderImmediate()
    this.syncUi()
  }

  seekSeconds(sec) {
    this.seek(Number(sec) * 1000)
  }

  tick(deltaMs) {
    if (!this.active) return
    if (this.playing) {
      this.time += deltaMs * this.speed
      if (this.time >= this.duration()) {
        if (this._exportDone) {
          this.time = this.duration()
          this.playing = false
          const done = this._exportDone
          this._exportDone = null
          done()
        } else if (this.loop) {
          this.time = 0
          const root = this.targetRoot()
          if (root) this.scene.cameraSwitcher._activeController?.activate?.(this.scene.camera, root)
        } else {
          this.time = this.duration()
          this.playing = false
        }
      }
    }
    this.applyAt(this.time)
    this.syncUi()
  }

  applyAt(ms) {
    const n = this.times.length
    if (n === 0) return
    this.ensureAmmo()

    let hi = 0
    while (hi < n - 1 && this.times[hi] < ms) hi++
    const lo = hi === 0 ? 0 : hi - 1
    const t0 = this.times[lo]
    const t1 = this.times[hi]
    const alpha = hi === lo || t1 === t0 ? 0 : (ms - t0) / (t1 - t0)

    for (const track of this.tracks) {
      if (!track.poses.length) continue
      const a = track.poses[Math.min(lo, track.poses.length - 1)]
      const b = track.poses[Math.min(hi, track.poses.length - 1)]
      if (alpha === 0 || a === b) {
        applyPose(track.vehicle, a, this._btQuat)
      } else {
        lerpPose(a, b, alpha, _pose)
        applyPose(track.vehicle, _pose, this._btQuat)
      }
    }
  }

  syncUi() {
    const total = this.duration()
    this.timeline.max = String(Math.max(1, total))
    this.timeline.value = String(this.time)
    this.timeLabel.textContent = `${formatReplayTime(this.time)} / ${formatReplayTime(total)}`
    this.playBtn.textContent = this.playing ? 'Pause' : 'Play'
    const ctrl = this.scene.cameraSwitcher._activeController
    const carMeta = this.vehicleMeta(this.targetVehicle(), this.targetCarIndex)
    this.badge.textContent = this.exporting
      ? 'EXPORTING'
      : `REPLAY · ${carMeta.name} · ${ctrl?.label || ''}`
    const busy = this.exporting
    this.playBtn.disabled = busy
    this.timeline.disabled = busy
    this.screenshotBtn.disabled = busy
    this.exportBtn.disabled = busy
    this.closeBtn.disabled = busy
    if (this.saveBtn) this.saveBtn.disabled = busy
    if (this.loadBtn) this.loadBtn.disabled = busy
    this.cameraSelect.disabled = busy
    this.cameraSelect.value = String(this.scene.cameraSwitcher._activeIndex)
    if (this.carSelect) {
      this.carSelect.disabled = busy
      this.carSelect.value = String(this.targetCarIndex)
    }
    if (this.speedSelect) {
      this.speedSelect.disabled = busy
      this.speedSelect.value = String(this.speed)
    }
  }

  screenshot(filename = `boxracing-${Date.now()}.png`) {
    const renderer = this.scene.renderer
    renderer.render(this.scene.scene, this.scene.camera)
    renderer.domElement.toBlob(blob => {
      if (!blob) throw new Error('Screenshot capture failed')
      downloadBlob(blob, filename)
    })
  }

  async exportVideo() {
    if (!this.active || this.exporting || this.times.length === 0) return
    const mimeType = pickRecorderMime()
    if (!mimeType) throw new Error('No supported MediaRecorder mime type')

    this.exporting = true
    this.playing = false
    this.seek(0)
    const root = this.targetRoot()
    this.scene.cameraSwitcher._activeController?.activate?.(
      this.scene.camera,
      root,
    )
    document.body.classList.add('replay-exporting')
    const cameraPanel = this.scene.cameraSwitcher?.panel
    if (cameraPanel) cameraPanel.style.visibility = 'hidden'
    this.syncUi()

    await new Promise(resolve => requestAnimationFrame(resolve))

    const canvas = this.scene.renderer.domElement
    const stream = canvas.captureStream(60)
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
    const chunks = []
    recorder.addEventListener('dataavailable', e => {
      if (e.data.size > 0) chunks.push(e.data)
    })
    const stopped = new Promise(resolve => {
      recorder.addEventListener('stop', resolve, { once: true })
    })
    const ended = new Promise(resolve => {
      this._exportDone = resolve
    })

    recorder.start(100)
    this.playing = true
    this.syncUi()
    await ended
    recorder.stop()
    await stopped
    for (const track of stream.getTracks()) track.stop()

    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
    downloadBlob(new Blob(chunks, { type: mimeType }), `boxracing-replay.${ext}`)

    document.body.classList.remove('replay-exporting')
    if (cameraPanel) cameraPanel.style.visibility = ''
    this.exporting = false
    this.syncUi()
  }

  dispose() {
    this.recording = false
    this.active = false
    this.playing = false
    clearTimeout(this._playTimeout)
    off('raceStart', this._onRaceStart)
    window.removeEventListener('keydown', this._onKeyDown)
    document.body.classList.remove('replay-playing', 'replay-exporting')
    this.overlay.classList.remove('visible')
  }
}

export { Replay, LAST_REPLAY_STORAGE_KEY }
