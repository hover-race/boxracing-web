import { on, off } from './raceEvents.js'
import { refreshAllBotShaders } from './botShaders.js'
import {
  saveReplay as saveReplayToStore,
  updateReplay as updateReplayInStore,
  captureThumbnail,
} from './replayStore.js'
import { recordingsBrowser } from './recordingsBrowser.js'

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
    _qa.set(a[o + 3], a[o + 4], a[o + 5], a[o + 6]).normalize()
    _qb.set(b[o + 3], b[o + 4], b[o + 5], b[o + 6]).normalize()
    _qt.slerpQuaternions(_qa, _qb, alpha).normalize()
    out[o + 3] = _qt.x
    out[o + 4] = _qt.y
    out[o + 5] = _qt.z
    out[o + 6] = _qt.w
  }
}

function applyPose(vehicle, pose, btQuat) {
  _pos.set(pose[0], pose[1], pose[2])
  _quat.set(pose[3], pose[4], pose[5], pose[6]).normalize()
  vehicle.syncBodyTransform(_pos, _quat)

  const ammoBody = vehicle.chassis.body.ammo
  const transform = ammoBody.getWorldTransform()
  transform.getOrigin().setValue(pose[0], pose[1], pose[2])
  btQuat.setValue(_quat.x, _quat.y, _quat.z, _quat.w)
  transform.setRotation(btQuat)
  ammoBody.setWorldTransform(transform)
  ammoBody.getMotionState()?.setWorldTransform(transform)

  for (let i = 0; i < WHEEL_COUNT; i++) {
    const o = 7 + i * 7
    const wheel = vehicle.wheelMeshes[i]
    wheel.position.set(pose[o], pose[o + 1], pose[o + 2])
    wheel.quaternion.set(pose[o + 3], pose[o + 4], pose[o + 5], pose[o + 6]).normalize()
  }
}

function formatReplayTime(ms) {
  const clamped = Math.max(0, Number(ms) || 0)
  const totalSec = Math.floor(clamped / 1000)
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  const tenths = Math.floor((clamped % 1000) / 100)
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`
}

function shortCamLabel(camId) {
  const map = {
    follow: 'Follow',
    overhead: 'Overhead',
    orbit: 'Orbit',
    bumper: 'Bumper',
    hood: 'Hood',
    side: 'Side',
    rear: 'Rear',
    trackside: 'Trackside',
    drone: 'Drone',
    rotate: 'Rotate',
  }
  return map[camId] || camId
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
    this.cuts = []
    this.clipInMs = 0
    this.clipOutMs = null
    this.clipMode = false
    this.currentRecordId = null
    this._persistTimer = 0
    this._dragKind = null
    this._dragAnchorMs = 0
    this.directorMode = true
    this.recordCuts = false
    this._activeCutIndex = -1
    this._cutTrackKey = ''
    this._playTimeout = 0
    this._exportDone = null
    this._stopAfterCapture = false
    this._btZero = null
    this._btQuat = null

    this.overlay = document.getElementById('replay-overlay')
    this.badge = document.getElementById('replay-badge')
    this.playBtn = document.getElementById('replay-play')
    this.timelineWrap = document.getElementById('replay-timeline-wrap')
    this.scrubber = document.getElementById('replay-scrubber')
    this.timeline = document.getElementById('replay-timeline')
    this.cutTrack = document.getElementById('replay-cut-track')
    this.clipDimLeft = document.getElementById('replay-clip-dim-left')
    this.clipDimRight = document.getElementById('replay-clip-dim-right')
    this.clipRangeEl = document.getElementById('replay-clip-range')
    this.clipInEl = document.getElementById('replay-clip-in')
    this.clipOutEl = document.getElementById('replay-clip-out')
    this.timeLabel = document.getElementById('replay-time')
    this.speedSelect = document.getElementById('replay-speed')
    this.carSelect = document.getElementById('replay-car')
    this.cameraSelect = document.getElementById('replay-camera')
    this.clipModeBtn = document.getElementById('replay-clip-mode')
    this.clearClipBtn = document.getElementById('replay-clear-clip')
    this.moreWrap = document.getElementById('replay-more-wrap')
    this.moreBtn = document.getElementById('replay-more-btn')
    this.moreMenu = document.getElementById('replay-more-menu')
    this.directorBtn = document.getElementById('replay-director')
    this.recCutsBtn = document.getElementById('replay-rec-cuts')
    this.addCutBtn = document.getElementById('replay-add-cut')
    this.delCutBtn = document.getElementById('replay-del-cut')
    this.autoCutBtn = document.getElementById('replay-auto-cut')
    this.clearCutsBtn = document.getElementById('replay-clear-cuts')
    this.recordingsBtn = document.getElementById('replay-recordings')
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
    this.recordingsBtn?.addEventListener('click', () => {
      this.setMoreOpen(false)
      recordingsBrowser.open()
    })
    this.screenshotBtn.addEventListener('click', () => {
      this.setMoreOpen(false)
      this.screenshot()
    })
    this.exportBtn.addEventListener('click', () => this.exportVideo())
    this.closeBtn.addEventListener('click', () => this.exit())
    this.saveBtn?.addEventListener('click', () => {
      this.setMoreOpen(false)
      this.downloadJson()
    })
    this.loadBtn?.addEventListener('click', () => {
      this.setMoreOpen(false)
      this.fileInput?.click()
    })
    this.fileInput?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0]
      if (!file) return
      const text = await file.text()
      const data = JSON.parse(text)
      const saved = await recordingsBrowser.importJson(data, file.name.replace(/\.json$/i, ''))
      this.loadJSON(data, { recordId: saved?.id })
      this.enter()
      e.target.value = ''
    })
    this.directorBtn?.addEventListener('click', () => {
      this.setDirectorMode(!this.directorMode)
      this.setMoreOpen(false)
    })
    this.recCutsBtn?.addEventListener('click', () => this.setRecordCuts(!this.recordCuts))
    this.addCutBtn?.addEventListener('click', () => this.addCut())
    this.delCutBtn?.addEventListener('click', () => this.removeCut())
    this.autoCutBtn?.addEventListener('click', () => {
      this.autoGenerateCuts()
      this.setMoreOpen(false)
    })
    this.clearCutsBtn?.addEventListener('click', () => {
      this.clearCuts()
      this.setMoreOpen(false)
    })
    this.clipModeBtn?.addEventListener('click', () => this.setClipMode(!this.clipMode))
    this.clearClipBtn?.addEventListener('click', () => {
      this.clearClip()
      this.setMoreOpen(false)
    })
    this.moreBtn?.addEventListener('click', (e) => {
      e.stopPropagation()
      this.setMoreOpen(Boolean(this.moreMenu?.hidden))
    })
    this._onDocClick = (e) => {
      if (this.moreWrap && !this.moreWrap.contains(e.target)) {
        this.setMoreOpen(false)
      }
    }
    document.addEventListener('click', this._onDocClick)

    this._setupClipScrubberInteractions()

    this.cameraSelect.addEventListener('change', () => {
      if (!this.exporting) this.setCamera(Number(this.cameraSelect.value), { fromUser: true })
    })
    this.carSelect?.addEventListener('change', () => {
      if (!this.exporting) this.setTargetCar(Number(this.carSelect.value), { fromUser: true })
    })
    this.speedSelect?.addEventListener('change', () => {
      if (!this.exporting) this.setSpeed(Number(this.speedSelect.value), { fromUser: true })
    })
    this.timeline.addEventListener('pointerdown', () => {
      if (!this.exporting && !this.clipMode) this.pause()
    })
    this.timeline.addEventListener('input', () => {
      if (this.exporting || this.clipMode) return
      this.seek(Number(this.timeline.value))
    })
    this._onKeyDown = (e) => {
      if (!this.active || e.repeat) return
      if (this.exporting) {
        if (e.code === 'Escape') {
          e.preventDefault()
          this.cancelExport()
        }
        return
      }
      if (e.target?.closest?.('input, button, select, textarea')) return
      if (e.code === 'Space') {
        e.preventDefault()
        this.togglePlay()
      } else if (e.code === 'KeyC' && e.shiftKey) {
        e.preventDefault()
        this.setClipMode(!this.clipMode)
      } else if (e.code === 'KeyI') {
        e.preventDefault()
        this.setClipIn(this.time)
      } else if (e.code === 'KeyO') {
        e.preventDefault()
        this.setClipOut(this.time)
      } else if (e.code === 'KeyX') {
        e.preventDefault()
        this.clearClip()
      } else if (e.code === 'BracketRight' || e.code === 'KeyN') {
        this.setTargetCar((this.targetCarIndex + 1) % Math.max(1, this.vehicles().length), { fromUser: true })
      } else if (e.code === 'BracketLeft' || e.code === 'KeyP') {
        const count = Math.max(1, this.vehicles().length)
        this.setTargetCar((this.targetCarIndex - 1 + count) % count, { fromUser: true })
      } else if (e.code === 'KeyK' || e.code === 'KeyM') {
        e.preventDefault()
        this.addCut()
      } else if (e.code === 'Backspace' || e.code === 'Delete') {
        e.preventDefault()
        this.removeCut()
      } else if (e.code === 'KeyD') {
        this.setDirectorMode(!this.directorMode)
      } else if (e.code === 'KeyR') {
        this.setRecordCuts(!this.recordCuts)
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        this.pause()
        this.seek(this.time - (e.shiftKey ? 100 : 500))
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        this.pause()
        this.seek(this.time + (e.shiftKey ? 100 : 500))
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
    if (!vehicle) return { index: 0, name: 'Player', carId: 'mustang', isPlayer: true }
    const racer = this.scene.checkpointManager?.racerForChassis(vehicle.chassis)
    const trackMeta = this.tracks[index]
    return {
      index,
      name: trackMeta?.name || racer?.name || (index === 0 ? 'Player' : `Bot ${index}`),
      carId: trackMeta?.carId || vehicle.car_id || 'mustang',
      isPlayer: index === 0,
    }
  }

  currentCameraId() {
    return this.scene.cameraSwitcher._activeController?.id || 'follow'
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
    if (raw === 'player' || raw === 'me' || raw === 'p1') return 0
    const botMatch = raw.match(/^(?:bot|p)\s*(\d+)$/)
    if (botMatch) {
      const n = Number(botMatch[1])
      return Math.max(0, Math.min(list.length - 1, raw.startsWith('p') ? n - 1 : n))
    }
    const found = list.findIndex((v, i) => {
      const meta = this.vehicleMeta(v, i)
      return meta.name.toLowerCase().includes(raw) || meta.carId.toLowerCase() === raw
    })
    return found >= 0 ? found : this.targetCarIndex
  }

  normalizeCut(raw = {}) {
    let t = this.time
    if (raw.tSec !== undefined && raw.tSec !== null && raw.tSec !== '') {
      t = Number(raw.tSec) * 1000
    } else if (raw.t !== undefined && raw.t !== null && raw.t !== '') {
      t = Number(raw.t)
    }
    if (!Number.isFinite(t) || t < 0) t = 0
    const dur = this.duration()
    if (dur > 0) t = Math.min(dur, t)

    const camIdx = this.scene.cameraSwitcher.resolveIndex(
      raw.cam ?? raw.camera ?? this.scene.cameraSwitcher._activeIndex
    )
    const camCtrl = this.scene.cameraSwitcher.controllers[camIdx]
    const cam = camCtrl?.id || 'follow'

    const car = this.resolveCarIndex(
      raw.car !== undefined && raw.car !== '' ? raw.car : this.targetCarIndex
    )
    const speed = Number(raw.speed) > 0 ? Number(raw.speed) : 1

    return {
      t: Math.round(t),
      cam,
      car,
      speed,
    }
  }

  parseCutsSpec(spec) {
    if (!spec) return []
    if (Array.isArray(spec)) {
      return spec.map(item => this.normalizeCut(item))
    }
    const text = String(spec).trim()
    if (!text) return []
    if (text.startsWith('[') || text.startsWith('{')) {
      const parsed = JSON.parse(text)
      const arr = Array.isArray(parsed) ? parsed : (parsed.cuts || [])
      return arr.map(item => this.normalizeCut(item))
    }
    const out = []
    for (const token of text.split(/[;,]/)) {
      const trimmed = token.trim()
      if (!trimmed) continue
      const [tStr, camStr, carStr, speedStr] = trimmed.split(':')
      const tSec = Number(tStr)
      if (!Number.isFinite(tSec)) continue
      out.push(this.normalizeCut({
        tSec,
        cam: camStr || 'follow',
        car: carStr !== undefined && carStr !== '' ? carStr : 0,
        speed: speedStr !== undefined && speedStr !== '' ? Number(speedStr) : 1,
      }))
    }
    return out
  }

  _sortAndDedupeCuts(cuts) {
    const sorted = cuts.slice().sort((a, b) => a.t - b.t)
    const deduped = []
    for (const c of sorted) {
      if (deduped.length && Math.abs(deduped[deduped.length - 1].t - c.t) <= 60) {
        deduped[deduped.length - 1] = c
      } else {
        deduped.push(c)
      }
    }
    return deduped
  }

  activeCutIndexAt(ms = this.time) {
    if (!this.cuts.length) return -1
    let idx = 0
    for (let i = 0; i < this.cuts.length; i++) {
      if (this.cuts[i].t <= ms + 1) idx = i
      else break
    }
    return idx
  }

  applyCutAt(ms = this.time, force = false) {
    if (!this.directorMode || !this.cuts.length) {
      this._activeCutIndex = -1
      return false
    }
    const idx = this.activeCutIndexAt(ms)
    if (idx < 0) return false
    const cut = this.cuts[idx]
    const camIdx = this.scene.cameraSwitcher.resolveIndex(cut.cam)
    const carIdx = this.resolveCarIndex(cut.car)
    const nextSpeed = cut.speed && cut.speed > 0 ? cut.speed : 1

    const changed = force ||
      idx !== this._activeCutIndex ||
      this.scene.cameraSwitcher._activeIndex !== camIdx ||
      this.targetCarIndex !== carIdx

    this._activeCutIndex = idx
    if (!changed) return false

    this.targetCarIndex = carIdx
    this.speed = nextSpeed
    this.scene.cameraSwitcher.setController(camIdx)
    const root = this.targetRoot()
    if (root) {
      this.scene.cameraSwitcher._lastTarget = root
      this.scene.cameraSwitcher._activeController?.activate?.(this.scene.camera, root)
    }
    return true
  }

  setDirectorMode(enabled) {
    this.directorMode = Boolean(enabled)
    this._activeCutIndex = -1
    if (this.directorMode && this.cuts.length) {
      this.applyCutAt(this.time, true)
      this.renderImmediate()
    }
    this.syncUi()
    return this.directorMode
  }

  setRecordCuts(enabled) {
    this.recordCuts = Boolean(enabled)
    if (this.recordCuts) {
      this.directorMode = true
      if (!this.cuts.length) {
        this.addCut({ t: this.time })
      }
    }
    this.syncUi()
    return this.recordCuts
  }

  _schedulePersistEdits() {
    if (!this.currentRecordId) return
    clearTimeout(this._persistTimer)
    const id = this.currentRecordId
    this._persistTimer = setTimeout(() => {
      const clip = this.getClip()
      updateReplayInStore(id, {
        cuts: this.getCuts(),
        clip: clip.custom ? { inMs: clip.inMs, outMs: clip.outMs, inSec: clip.inSec, outSec: clip.outSec } : null,
      })
    }, 250)
  }

  addCut(raw = {}) {
    const cut = this.normalizeCut(raw)
    const existingIdx = this.cuts.findIndex(c => Math.abs(c.t - cut.t) <= 150)
    if (existingIdx >= 0) {
      this.cuts[existingIdx] = cut
    } else {
      this.cuts.push(cut)
    }
    this.cuts = this._sortAndDedupeCuts(this.cuts)
    this.directorMode = true
    this._cutTrackKey = ''
    this.applyCutAt(this.time, true)
    this.renderImmediate()
    this.syncUi()
    this._schedulePersistEdits()
    return this.serializeCut(cut)
  }

  removeCut(indexOrTime) {
    if (!this.cuts.length) return []
    let idx = -1
    if (indexOrTime === undefined) {
      idx = this.activeCutIndexAt(this.time)
    } else if (typeof indexOrTime === 'number' && Number.isInteger(indexOrTime) && indexOrTime >= 0 && indexOrTime < this.cuts.length) {
      idx = indexOrTime
    } else {
      const rawT = Number(indexOrTime)
      const targetMs = rawT <= this.duration() / 1000 ? rawT * 1000 : rawT
      let bestDist = Infinity
      this.cuts.forEach((c, i) => {
        const d = Math.abs(c.t - targetMs)
        if (d < bestDist) {
          bestDist = d
          idx = i
        }
      })
    }
    if (idx >= 0 && idx < this.cuts.length) {
      this.cuts.splice(idx, 1)
      this._activeCutIndex = -1
      this._cutTrackKey = ''
      if (this.cuts.length && this.directorMode) {
        this.applyCutAt(this.time, true)
        this.renderImmediate()
      }
      this.syncUi()
      this._schedulePersistEdits()
    }
    return this.getCuts()
  }

  clearCuts() {
    this.cuts = []
    this._activeCutIndex = -1
    this.directorMode = false
    this._cutTrackKey = ''
    this.syncUi()
    this._schedulePersistEdits()
    return []
  }

  setCuts(spec) {
    const parsed = this.parseCutsSpec(spec)
    this.cuts = this._sortAndDedupeCuts(parsed)
    this.directorMode = this.cuts.length > 0
    this._activeCutIndex = -1
    this._cutTrackKey = ''
    if (this.active && this.directorMode) {
      this.applyCutAt(this.time, true)
      this.renderImmediate()
    }
    this.syncUi()
    this._schedulePersistEdits()
    return this.getCuts()
  }

  serializeCut(c) {
    return {
      t: Math.round(c.t),
      tSec: Number((c.t / 1000).toFixed(2)),
      cam: c.cam,
      car: c.car,
      ...(c.speed && c.speed !== 1 ? { speed: c.speed } : {}),
    }
  }

  getCuts() {
    return this.cuts.map(c => this.serializeCut(c))
  }

  getCutsParam() {
    return this.cuts.map(c => {
      const tSec = Number((c.t / 1000).toFixed(2))
      const base = `${tSec}:${c.cam}:${c.car}`
      return c.speed && c.speed !== 1 ? `${base}:${c.speed}` : base
    }).join(',')
  }

  autoGenerateCuts(intervalSec = 3) {
    const total = this.duration()
    if (total <= 0) return []
    const stepMs = Math.max(1200, (Number(intervalSec) || 3) * 1000)
    const camCycle = ['trackside', 'hood', 'drone', 'rear', 'rotate', 'follow', 'side', 'bumper']
    const carCount = Math.max(1, this.vehicles().length)
    const generated = []
    let t = 0
    let shot = 0
    while (t < total - 600) {
      const cam = camCycle[shot % camCycle.length]
      const car = shot % carCount
      generated.push(this.normalizeCut({ t, cam, car, speed: 1 }))
      t += stepMs
      shot++
    }
    this.cuts = this._sortAndDedupeCuts(generated)
    this.directorMode = true
    this._activeCutIndex = -1
    this._cutTrackKey = ''
    if (this.active) {
      this.applyCutAt(this.time, true)
      this.renderImmediate()
    }
    this.syncUi()
    this._schedulePersistEdits()
    return this.getCuts()
  }

  _maybeRecordUserCut() {
    if (this.recordCuts) {
      this.addCut({
        t: this.time,
        cam: this.currentCameraId(),
        car: this.targetCarIndex,
        speed: this.speed,
      })
      return
    }
    if (!this.playing && this.directorMode && this.cuts.length) {
      const nearIdx = this.cuts.findIndex(c => Math.abs(c.t - this.time) <= 180)
      if (nearIdx >= 0) {
        this.cuts[nearIdx] = this.normalizeCut({
          t: this.cuts[nearIdx].t,
          cam: this.currentCameraId(),
          car: this.targetCarIndex,
          speed: this.speed,
        })
        this._cutTrackKey = ''
        this._schedulePersistEdits()
      }
    }
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

  setTargetCar(indexOrName, { fromUser = false } = {}) {
    this.targetCarIndex = this.resolveCarIndex(indexOrName)
    if (fromUser) this._maybeRecordUserCut()
    this.renderImmediate()
    this.syncUi()
    return this.vehicleMeta(this.targetVehicle(), this.targetCarIndex)
  }

  setCamera(idOrIndex, { fromUser = false } = {}) {
    this.scene.cameraSwitcher.setController(idOrIndex)
    if (fromUser) this._maybeRecordUserCut()
    this.renderImmediate()
    this.syncUi()
    const ctrl = this.scene.cameraSwitcher._activeController
    return { index: this.scene.cameraSwitcher._activeIndex, id: ctrl?.id, label: ctrl?.label }
  }

  setSpeed(multiplier, { fromUser = false } = {}) {
    const n = Number(multiplier)
    if (Number.isFinite(n) && n > 0) {
      this.speed = n
    }
    if (fromUser) this._maybeRecordUserCut()
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

  setMoreOpen(open) {
    if (!this.moreMenu || !this.moreBtn) return
    this.moreMenu.hidden = !open
    this.moreBtn.setAttribute('aria-expanded', String(Boolean(open)))
  }

  _clientXToTimeMs(clientX) {
    const el = this.scrubber || this.timeline
    const rect = el.getBoundingClientRect()
    const frac = rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0
    return frac * this.duration()
  }

  _setupClipScrubberInteractions() {
    if (!this.scrubber) return

    const onHandleDown = (kind) => (e) => {
      if (this.exporting) return
      e.preventDefault()
      e.stopPropagation()
      this.pause()
      this._dragKind = kind
    }
    this.clipInEl?.addEventListener('pointerdown', onHandleDown('in'))
    this.clipOutEl?.addEventListener('pointerdown', onHandleDown('out'))

    this.scrubber.addEventListener('pointerdown', (e) => {
      if (this.exporting || !this.clipMode) return
      if (e.target === this.clipInEl || e.target === this.clipOutEl) return
      e.preventDefault()
      e.stopPropagation()
      this.pause()
      const ms = this._clientXToTimeMs(e.clientX)
      this._dragKind = 'range'
      this._dragAnchorMs = ms
      this._dragMoved = false
      this.seek(ms)
    })

    this._onPointerMove = (e) => {
      if (!this._dragKind || this.exporting) return
      const ms = this._clientXToTimeMs(e.clientX)
      if (this._dragKind === 'in') {
        this.setClipIn(ms)
        this.seek(this.clipIn())
      } else if (this._dragKind === 'out') {
        this.setClipOut(ms)
        this.seek(this.clipOut())
      } else if (this._dragKind === 'range') {
        if (Math.abs(ms - this._dragAnchorMs) > 60) {
          this._dragMoved = true
        }
        if (this._dragMoved) {
          const lo = Math.min(this._dragAnchorMs, ms)
          const hi = Math.max(this._dragAnchorMs, ms)
          this.setClipMs(lo, hi)
        }
        this.seek(ms)
      }
    }

    this._onPointerUp = () => {
      this._dragKind = null
      this._dragMoved = false
    }

    window.addEventListener('pointermove', this._onPointerMove)
    window.addEventListener('pointerup', this._onPointerUp)
  }

  clipIn() {
    const total = this.duration()
    return Math.max(0, Math.min(total, Number(this.clipInMs) || 0))
  }

  clipOut() {
    const total = this.duration()
    if (this.clipOutMs === null || this.clipOutMs === undefined || !Number.isFinite(this.clipOutMs)) {
      return total
    }
    return Math.max(this.clipIn(), Math.min(total, Number(this.clipOutMs)))
  }

  hasCustomClip() {
    const total = this.duration()
    if (total <= 0) return false
    return this.clipIn() > 10 || (this.clipOutMs !== null && this.clipOut() < total - 10)
  }

  setClipMs(inMs, outMs) {
    const total = this.duration()
    const minSpan = Math.min(200, Math.max(20, total))
    let a = Number.isFinite(Number(inMs)) ? Number(inMs) : 0
    let b = outMs === null || outMs === undefined || !Number.isFinite(Number(outMs)) ? total : Number(outMs)
    if (total > 0) {
      a = Math.max(0, Math.min(total, a))
      b = Math.max(0, Math.min(total, b))
      if (b < a) {
        const tmp = a
        a = b
        b = tmp
      }
      if (b - a < minSpan) {
        if (b + minSpan <= total) b = a + minSpan
        else a = Math.max(0, b - minSpan)
      }
    } else {
      a = Math.max(0, a)
      b = Math.max(a, b)
    }
    this.clipInMs = Math.round(a)
    this.clipOutMs = total > 0 && b >= total - 5 && a <= 5 ? null : Math.round(b)
    this.syncUi()
    this._schedulePersistEdits()
    return this.getClip()
  }

  setClipIn(ms = this.time) {
    const total = this.duration()
    const minSpan = Math.min(200, Math.max(20, total))
    const clamped = Math.max(0, Math.min(total, Number(ms) || 0))
    const curOut = this.clipOut()
    const nextOut = clamped > curOut - minSpan ? total : curOut
    return this.setClipMs(clamped, nextOut)
  }

  setClipOut(ms = this.time) {
    const total = this.duration()
    const minSpan = Math.min(200, Math.max(20, total))
    const clamped = Math.max(0, Math.min(total, Number(ms) || 0))
    const curIn = this.clipIn()
    const nextIn = clamped < curIn + minSpan ? 0 : curIn
    return this.setClipMs(nextIn, clamped)
  }

  setClip(inVal, outVal) {
    if (inVal && typeof inVal === 'object') {
      const inMs = inVal.inMs !== undefined ? Number(inVal.inMs) : Number(inVal.inSec ?? inVal.in ?? 0) * 1000
      const outRaw = inVal.outMs !== undefined ? inVal.outMs : (inVal.outSec ?? inVal.out)
      const outMs = outRaw === undefined || outRaw === null ? this.duration() : (inVal.outMs !== undefined ? Number(outRaw) : Number(outRaw) * 1000)
      return this.setClipMs(inMs, outMs)
    }
    const total = this.duration()
    const toMs = (v, fallback) => {
      if (v === undefined || v === null || v === '' || Number(v) < 0) return fallback
      const n = Number(v)
      if (!Number.isFinite(n)) return fallback
      return n <= Math.max(600, total / 1000) ? n * 1000 : n
    }
    return this.setClipMs(toMs(inVal, 0), toMs(outVal, total))
  }

  clearClip() {
    this.clipInMs = 0
    this.clipOutMs = null
    this.syncUi()
    this._schedulePersistEdits()
    return this.getClip()
  }

  getClip() {
    const inMs = Math.round(this.clipIn())
    const outMs = Math.round(this.clipOut())
    const durationMs = Math.max(0, outMs - inMs)
    return {
      inMs,
      outMs,
      durationMs,
      inSec: Number((inMs / 1000).toFixed(2)),
      outSec: Number((outMs / 1000).toFixed(2)),
      durationSec: Number((durationMs / 1000).toFixed(2)),
      custom: this.hasCustomClip(),
    }
  }

  setClipMode(enabled) {
    this.clipMode = Boolean(enabled)
    this.syncUi()
    return this.clipMode
  }

  status() {
    const ctrl = this.scene.cameraSwitcher._activeController
    return {
      active: this.active,
      playing: this.playing,
      recording: this.recording,
      exporting: this.exporting,
      recordId: this.currentRecordId,
      time: Math.round(this.time),
      duration: Math.round(this.duration()),
      frames: this.times.length,
      speed: this.speed,
      loop: this.loop,
      clip: this.getClip(),
      clipMode: this.clipMode,
      directorMode: this.directorMode,
      recordCuts: this.recordCuts,
      activeCutIndex: this._activeCutIndex,
      cuts: this.getCuts(),
      cutsParam: this.getCutsParam(),
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
    this.cuts = []
    this.clipInMs = 0
    this.clipOutMs = null
    this.clipMode = false
    this.currentRecordId = null
    this._cutTrackKey = ''
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
      if (params.replay || params.replayCam || params.replayCar || params.replayCuts || params.replayTime >= 0 || params.replayExport) {
        this.enterFromParams()
      }
    }
  }

  toJSON() {
    const clip = this.getClip()
    return {
      version: 1,
      recordedAt: new Date().toISOString(),
      duration: Math.round(this.duration()),
      cuts: this.getCuts(),
      ...(clip.custom ? { clip: { inMs: clip.inMs, outMs: clip.outMs, inSec: clip.inSec, outSec: clip.outSec } } : {}),
      times: this.times.map(t => Math.round(t * 10) / 10),
      tracks: this.tracks.map((track, index) => {
        const meta = this.vehicleMeta(track.vehicle, index)
        return {
          name: track.name || meta.name,
          carId: track.carId || meta.carId,
          isPlayer: index === 0,
          poses: track.poses.map(pose => Array.from(pose, (v, idx) => {
            const scale = (idx % 7) < 3 ? 1000 : 100000
            return Math.round(v * scale) / scale
          })),
        }
      }),
    }
  }

  loadJSON(data, { recordId = null } = {}) {
    if (!data || !Array.isArray(data.times) || !Array.isArray(data.tracks)) {
      throw new Error('Invalid replay JSON format')
    }
    this.currentRecordId = recordId
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
    if (Array.isArray(data.cuts)) {
      this.cuts = this._sortAndDedupeCuts(data.cuts.map(c => this.normalizeCut(c)))
      this.directorMode = this.cuts.length > 0
    } else {
      this.cuts = []
      this.directorMode = false
    }
    if (data.clip && typeof data.clip === 'object') {
      this.setClip(data.clip)
    } else {
      this.clipInMs = 0
      this.clipOutMs = null
    }
    this._activeCutIndex = -1
    this._cutTrackKey = ''
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
    const cm = this.scene.checkpointManager
    const ranked = cm?.rankedRacers?.() || []
    const place = cm?.playerRacer && ranked.length ? ranked.indexOf(cm.playerRacer) + 1 : null
    const laps = cm?.totalLaps || params.numLaps || null
    const thumbnail = captureThumbnail(this.scene)
    const id = this.currentRecordId || `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    this.currentRecordId = id
    saveReplayToStore({
      id,
      durationMs: data.duration,
      carCount: data.tracks.length,
      playerCarId: data.tracks[0]?.carId || params.car_id || 'mustang',
      playerName: data.tracks[0]?.name || params.playerName || 'Player',
      laps,
      place: place && place > 0 ? place : null,
      thumbnail,
      data,
    })
    return data
  }

  downloadJson(filename = `boxracing-replay-${Date.now()}.json`) {
    if (!this.times.length) return null
    const data = this.toJSON()
    if (!this.currentRecordId) this.saveLastReplay()
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    downloadBlob(blob, filename)
    return data
  }

  enterFromParams() {
    if (params.replayCuts) {
      this.setCuts(params.replayCuts)
    }
    if (Number(params.replayIn) >= 0 || Number(params.replayOut) >= 0) {
      this.setClip(
        Number(params.replayIn) >= 0 ? Number(params.replayIn) : 0,
        Number(params.replayOut) >= 0 ? Number(params.replayOut) : this.duration() / 1000,
      )
    }
    const hasExplicitSingleCam = Boolean((params.replayCam || params.replayCar) && !params.replayCuts)
    this.enter({
      camera: params.replayCam || 'follow',
      car: params.replayCar || 0,
      time: params.replayTime,
      speed: params.replaySpeed,
      playing: params.replayPlaying,
      loop: params.replayLoop,
      directorMode: hasExplicitSingleCam ? false : this.cuts.length > 0,
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
    if (this.recording && this.times.length > 0 && !this.currentRecordId) {
      this.saveLastReplay()
    }
    this.recording = false
    clearTimeout(this._playTimeout)
    this.scene.cancelRoundCountdown?.()
    this.active = true
    this._cameraBeforeReplay = this.scene.cameraSwitcher._activeIndex
    params.runPhysics = false
    this.freezeAll()
    this.silenceAll()
    refreshAllBotShaders(this.scene, 'none')
    this.scene.checkpointManager.finishElement.classList.remove('visible')
    document.body.classList.add('replay-playing')
    this.overlay.classList.add('visible')
    this.refreshCarOptions()

    if (options.cuts !== undefined) {
      this.setCuts(options.cuts)
    }
    if (options.clip !== undefined) {
      this.setClip(options.clip)
    }
    if (options.directorMode !== undefined) {
      this.directorMode = Boolean(options.directorMode)
    } else if (this.cuts.length > 0) {
      this.directorMode = true
    }

    if (options.speed !== undefined && Number(options.speed) > 0) {
      this.speed = Number(options.speed)
    }
    if (options.loop !== undefined) {
      this.loop = Boolean(options.loop)
    }

    const initialCar = options.car !== undefined && options.car !== '' ? options.car : this.targetCarIndex
    this.targetCarIndex = this.resolveCarIndex(initialCar)

    const initialCamera = options.camera !== undefined && options.camera !== '' ? options.camera : 0
    this.scene.cameraSwitcher.setController(initialCamera)

    let initialTimeMs = this.clipIn()
    if (options.time !== undefined && Number(options.time) >= 0) {
      const rawTime = Number(options.time)
      initialTimeMs = rawTime <= this.duration() / 1000 ? rawTime * 1000 : rawTime
    }
    this._activeCutIndex = -1
    this.seek(initialTimeMs)

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
    refreshAllBotShaders(this.scene)
    this.scene.cameraSwitcher.setController(this._cameraBeforeReplay)
    document.body.classList.remove('replay-playing')
    this.overlay.classList.remove('visible')
    if (this.scene.checkpointManager.raceFinished && this.scene.isRoundHost?.()) {
      this.scene.hostScheduleStart()
    }
  }

  freezeAll() {
    this.ensureAmmo()
    for (const vehicle of this.vehicles()) {
      vehicle.applyCollisionPushTint?.(0)
      if (vehicle._grayUntil) {
        vehicle._grayUntil = 1
        vehicle.updateCollisionGrayOut?.()
      }
      vehicle.chassis.body.skipUpdate = true
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
    refreshAllBotShaders(this.scene)
    params.runPhysics = true
  }

  restorePhysics() {
    for (const vehicle of this.vehicles()) {
      vehicle.chassis.body.skipUpdate = false
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
    const inMs = this.clipIn()
    const outMs = this.clipOut()
    if (this.time >= outMs || (this.hasCustomClip() && this.time < inMs)) {
      this.time = inMs
      this._activeCutIndex = -1
      this.applyCutAt(this.time, true)
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
    this.applyCutAt(this.time, true)
    this.renderImmediate()
    this.syncUi()
  }

  seekSeconds(sec) {
    this.seek(Number(sec) * 1000)
  }

  tick(deltaMs) {
    if (!this.active) return
    if (this.playing) {
      const inMs = this.clipIn()
      const outMs = this.clipOut()
      this.time += deltaMs * this.speed
      if (this.time >= outMs) {
        if (this._exportDone) {
          this.time = outMs
          this.playing = false
          const done = this._exportDone
          this._exportDone = null
          done()
        } else if (this.loop) {
          this.time = inMs
          this._activeCutIndex = -1
        } else {
          this.time = outMs
          this.playing = false
        }
      }
    }
    this.applyAt(this.time)
    if (this.applyCutAt(this.time, false)) {
      this.renderImmediate()
    }
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

  renderCutTrack() {
    if (!this.cutTrack) return
    const total = Math.max(1, this.duration())
    const key = `${total}:${this.getCutsParam()}`
    if (key !== this._cutTrackKey) {
      this._cutTrackKey = key
      this.cutTrack.replaceChildren()
      this.cuts.forEach((cut, idx) => {
        const nextT = idx + 1 < this.cuts.length ? this.cuts[idx + 1].t : total
        const leftPct = Math.max(0, Math.min(99, (cut.t / total) * 100))
        const widthPct = Math.max(1.5, ((nextT - cut.t) / total) * 100)
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'replay-cut-marker'
        btn.dataset.cutIndex = String(idx)
        btn.style.left = `${leftPct.toFixed(2)}%`
        btn.style.width = `calc(${widthPct.toFixed(2)}% - 2px)`
        const carIdx = this.resolveCarIndex(cut.car)
        const carMeta = this.vehicleMeta(this.vehicles()[carIdx], carIdx)
        const speedTag = cut.speed && cut.speed !== 1 ? ` · ${cut.speed}x` : ''
        const label = `${shortCamLabel(cut.cam)} · P${carIdx + 1}${speedTag}`
        btn.textContent = label
        btn.title = `${formatReplayTime(cut.t)} — ${shortCamLabel(cut.cam)} on ${carMeta.name}${speedTag}`
        btn.addEventListener('click', (e) => {
          e.stopPropagation()
          if (this.exporting) return
          this.directorMode = true
          this.seek(cut.t)
        })
        this.cutTrack.appendChild(btn)
      })
    }
    const activeIdx = this.directorMode ? this.activeCutIndexAt(this.time) : -1
    for (const child of this.cutTrack.children) {
      child.classList.toggle('active', Number(child.dataset.cutIndex) === activeIdx)
    }
  }

  renderClipOverlay() {
    const total = Math.max(1, this.duration())
    const inMs = this.clipIn()
    const outMs = this.clipOut()
    const inPct = Math.max(0, Math.min(100, (inMs / total) * 100))
    const outPct = Math.max(inPct, Math.min(100, (outMs / total) * 100))
    const custom = this.hasCustomClip()
    const showHandles = custom || this.clipMode

    if (this.clipDimLeft) {
      this.clipDimLeft.style.width = custom ? `${inPct.toFixed(2)}%` : '0%'
    }
    if (this.clipDimRight) {
      this.clipDimRight.style.width = custom ? `${(100 - outPct).toFixed(2)}%` : '0%'
    }
    if (this.clipRangeEl) {
      this.clipRangeEl.style.display = showHandles ? '' : 'none'
      this.clipRangeEl.style.left = `${inPct.toFixed(2)}%`
      this.clipRangeEl.style.width = `${Math.max(0.5, outPct - inPct).toFixed(2)}%`
    }
    if (this.clipInEl) {
      this.clipInEl.style.display = showHandles ? '' : 'none'
      this.clipInEl.style.left = `${inPct.toFixed(2)}%`
    }
    if (this.clipOutEl) {
      this.clipOutEl.style.display = showHandles ? '' : 'none'
      this.clipOutEl.style.left = `${outPct.toFixed(2)}%`
    }
  }

  syncUi() {
    const total = this.duration()
    const clip = this.getClip()
    this.timeline.max = String(Math.max(1, total))
    this.timeline.value = String(this.time)
    this.timeLabel.textContent = `${formatReplayTime(this.time)} / ${formatReplayTime(total)}`
    this.playBtn.textContent = this.playing ? 'Pause' : 'Play'
    const ctrl = this.scene.cameraSwitcher._activeController
    const carMeta = this.vehicleMeta(this.targetVehicle(), this.targetCarIndex)
    const modeTag = this.recordCuts
      ? ' · REC CUTS'
      : (this.directorMode && this.cuts.length ? ` · CUT ${this.activeCutIndexAt(this.time) + 1}/${this.cuts.length}` : '')
    const clipTag = clip.custom ? ` · CLIP ${formatReplayTime(clip.inMs)}–${formatReplayTime(clip.outMs)}` : ''
    this.badge.textContent = this.exporting
      ? 'EXPORTING'
      : `REPLAY · ${carMeta.name} · ${ctrl?.label || ''}${modeTag}${clipTag}`
    const busy = this.exporting
    this.playBtn.disabled = busy
    this.timeline.disabled = busy
    this.screenshotBtn.disabled = busy
    this.exportBtn.disabled = busy
    this.exportBtn.textContent = this.exporting
      ? 'Exporting…'
      : `Export ${formatReplayTime(clip.durationMs)}`
    this.closeBtn.disabled = busy
    if (this.moreBtn) this.moreBtn.disabled = busy
    if (this.saveBtn) this.saveBtn.disabled = busy
    if (this.loadBtn) this.loadBtn.disabled = busy
    if (this.clipModeBtn) {
      this.clipModeBtn.disabled = busy
      this.clipModeBtn.classList.toggle('active', this.clipMode)
      this.clipModeBtn.setAttribute('aria-pressed', String(this.clipMode))
    }
    if (this.clearClipBtn) {
      this.clearClipBtn.disabled = busy || !clip.custom
    }
    this.timelineWrap?.classList.toggle('clip-mode', this.clipMode)
    if (this.directorBtn) {
      this.directorBtn.disabled = busy
      const dirActive = this.directorMode && this.cuts.length > 0
      this.directorBtn.classList.toggle('active', dirActive)
      this.directorBtn.setAttribute('aria-checked', String(dirActive))
    }
    if (this.recCutsBtn) {
      this.recCutsBtn.disabled = busy
      this.recCutsBtn.classList.toggle('active', this.recordCuts)
      this.recCutsBtn.setAttribute('aria-pressed', String(this.recordCuts))
    }
    if (this.addCutBtn) this.addCutBtn.disabled = busy
    if (this.delCutBtn) this.delCutBtn.disabled = busy || this.cuts.length === 0
    if (this.autoCutBtn) this.autoCutBtn.disabled = busy
    if (this.clearCutsBtn) this.clearCutsBtn.disabled = busy || this.cuts.length === 0
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
    this.renderCutTrack()
    this.renderClipOverlay()
  }

  screenshot(filename = `boxracing-${Date.now()}.png`) {
    const renderer = this.scene.renderer
    renderer.render(this.scene.scene, this.scene.camera)
    renderer.domElement.toBlob(blob => {
      if (!blob) throw new Error('Screenshot capture failed')
      downloadBlob(blob, filename)
    })
  }

  cancelExport() {
    if (!this.exporting) return false
    this._exportCanceled = true
    this.playing = false
    if (this._exportRecorder && this._exportRecorder.state !== 'inactive') {
      this._exportRecorder.stop()
    }
    if (this._exportStream) {
      for (const track of this._exportStream.getTracks()) track.stop()
    }
    if (this._exportDone) {
      const done = this._exportDone
      this._exportDone = null
      done()
    }
    document.body.classList.remove('replay-exporting')
    const cameraPanel = this.scene.cameraSwitcher?.panel
    if (cameraPanel) cameraPanel.style.visibility = ''
    this.exporting = false
    this.syncUi()
    return true
  }

  async exportVideo() {
    if (!this.active || this.exporting || this.times.length === 0) return
    const mimeType = pickRecorderMime()
    if (!mimeType) throw new Error('No supported MediaRecorder mime type')

    const clip = this.getClip()
    this.setMoreOpen(false)
    this.exporting = true
    this._exportCanceled = false
    this.playing = false
    this._activeCutIndex = -1
    this.seek(clip.inMs)
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
    if (this._exportCanceled) return

    const canvas = this.scene.renderer.domElement
    const stream = canvas.captureStream(60)
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
    this._exportRecorder = recorder
    this._exportStream = stream
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
    if (recorder.state !== 'inactive') recorder.stop()
    await stopped
    for (const track of stream.getTracks()) track.stop()
    this._exportRecorder = null
    this._exportStream = null

    const canceled = this._exportCanceled
    this._exportCanceled = false
    document.body.classList.remove('replay-exporting')
    if (cameraPanel) cameraPanel.style.visibility = ''
    this.exporting = false
    this.syncUi()

    if (!canceled) {
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
      const rangeSuffix = clip.custom
        ? `-${clip.inSec}s-${clip.outSec}s`
        : ''
      downloadBlob(new Blob(chunks, { type: mimeType }), `boxracing-replay${rangeSuffix}.${ext}`)
    }
  }

  dispose() {
    this.recording = false
    this.active = false
    this.playing = false
    clearTimeout(this._playTimeout)
    clearTimeout(this._persistTimer)
    off('raceStart', this._onRaceStart)
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('pointermove', this._onPointerMove)
    window.removeEventListener('pointerup', this._onPointerUp)
    document.removeEventListener('click', this._onDocClick)
    document.body.classList.remove('replay-playing', 'replay-exporting')
    this.overlay.classList.remove('visible')
  }
}

export { Replay }
