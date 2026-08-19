import { on, off } from './raceEvents.js'

const POSE_FLOATS = 7 + 4 * 7
const WHEEL_COUNT = 4
const CF_KINEMATIC_OBJECT = 2
const DISABLE_DEACTIVATION = 4

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
    this.screenshotBtn = document.getElementById('replay-screenshot')
    this.exportBtn = document.getElementById('replay-export')
    if (!this.overlay) throw new Error('replay-overlay element missing')

    this.playBtn.addEventListener('click', () => this.togglePlay())
    this.screenshotBtn.addEventListener('click', () => this.screenshot())
    this.exportBtn.addEventListener('click', () => this.exportVideo())
    this.timeline.addEventListener('pointerdown', () => {
      if (!this.exporting) this.pause()
    })
    this.timeline.addEventListener('input', () => {
      if (this.exporting) return
      this.seek(Number(this.timeline.value))
    })
    this._onKeyDown = (e) => {
      if (!this.active || this.exporting || e.repeat) return
      if (e.target?.closest?.('input, button, textarea')) return
      if (e.code !== 'Space') return
      e.preventDefault()
      this.togglePlay()
    }
    window.addEventListener('keydown', this._onKeyDown)

    this._onRaceStart = () => this.startRecording()
    on('raceStart', this._onRaceStart)
  }

  vehicles() {
    return [this.scene.car, ...(this.scene.bots ?? []).map(entry => entry.car)].filter(Boolean)
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
    this.times = []
    this.tracks = this.vehicles().map(vehicle => ({ vehicle, poses: [] }))
    this.origin = performance.now()
    this.recording = true
    this._stopAfterCapture = false
  }

  capture() {
    if (!this.tracks.length) return
    const t = performance.now() - this.origin
    this.times.push(t)
    for (const track of this.tracks) {
      const pose = new Float32Array(POSE_FLOATS)
      writePose(track.vehicle, pose)
      track.poses.push(pose)
    }
  }

  recordFrame() {
    if (!this.recording || this.active) return
    this.capture()
    if (this._stopAfterCapture) {
      this.recording = false
      this._stopAfterCapture = false
    }
  }

  onPlayerFinished() {
    this._stopAfterCapture = true
    clearTimeout(this._playTimeout)
    this._playTimeout = setTimeout(() => this.enter(), 2500)
  }

  enter() {
    this.recording = false
    if (this.active || this.times.length === 0) return
    this.active = true
    params.runPhysics = false
    this.freezeAll()
    this.silenceAll()
    this.scene.checkpointManager.finishElement.classList.remove('visible')
    document.body.classList.add('replay-playing')
    this.overlay.classList.add('visible')
    this.seek(0)
    this.scene.cameraSwitcher.setController(0)
    this.scene.cameraSwitcher.follow.activate(this.scene.camera, this.scene.car.visualRoot)
    this.playing = true
    this.syncUi()
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
      this.scene.cameraSwitcher.follow.activate(this.scene.camera, this.scene.car.visualRoot)
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
    this.syncUi()
  }

  tick(deltaMs) {
    if (!this.active) return
    if (this.playing) {
      this.time += deltaMs
      if (this.time >= this.duration()) {
        this.time = this.duration()
        this.playing = false
        if (this._exportDone) {
          const done = this._exportDone
          this._exportDone = null
          done()
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
      const a = track.poses[lo]
      const b = track.poses[hi]
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
    this.badge.textContent = this.exporting ? 'EXPORTING' : 'REPLAY'
    const busy = this.exporting
    this.playBtn.disabled = busy
    this.timeline.disabled = busy
    this.screenshotBtn.disabled = busy
    this.exportBtn.disabled = busy
  }

  screenshot() {
    const renderer = this.scene.renderer
    renderer.render(this.scene.scene, this.scene.camera)
    renderer.domElement.toBlob(blob => {
      if (!blob) throw new Error('Screenshot capture failed')
      downloadBlob(blob, `boxracing-${Date.now()}.png`)
    })
  }

  async exportVideo() {
    if (!this.active || this.exporting || this.times.length === 0) return
    const mimeType = pickRecorderMime()
    if (!mimeType) throw new Error('No supported MediaRecorder mime type')

    this.exporting = true
    this.playing = false
    this.seek(0)
    this.scene.cameraSwitcher._activeController?.activate?.(
      this.scene.camera,
      this.scene.car.visualRoot,
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

export { Replay }
