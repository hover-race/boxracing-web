const DB_NAME = 'boxracing-replays'
const DB_VERSION = 1
const STORE_NAME = 'replays'
const DEFAULT_KEEP = 20

let _dbPromise = null

function openReplayDb() {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return _dbPromise
}

function formatDefaultName({ laps, place, createdAt, playerCarId }) {
  const d = new Date(createdAt || Date.now())
  const month = d.toLocaleString('en-US', { month: 'short' })
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const parts = ['Oval']
  if (laps) parts.push(`${laps} ${laps === 1 ? 'lap' : 'laps'}`)
  if (place) parts.push(`P${place}`)
  else if (playerCarId) parts.push(playerCarId)
  parts.push(`${month} ${day} ${hh}:${mm}`)
  return parts.join(' · ')
}

function stripData(record) {
  if (!record) return null
  const { data, ...meta } = record
  return meta
}

function packReplayData(data) {
  if (!data || !Array.isArray(data.times) || !Array.isArray(data.tracks)) {
    throw new Error('Invalid replay data for storage')
  }
  return {
    version: data.version || 1,
    recordedAt: data.recordedAt || new Date().toISOString(),
    duration: Number(data.duration) || 0,
    cuts: Array.isArray(data.cuts) ? data.cuts : [],
    ...(data.clip ? { clip: data.clip } : {}),
    timesBuf: new Float32Array(data.times).buffer,
    tracks: data.tracks.map(t => {
      const frameCount = t.poses.length
      const flat = new Float32Array(frameCount * 35)
      for (let i = 0; i < frameCount; i++) {
        flat.set(t.poses[i], i * 35)
      }
      return {
        name: t.name,
        carId: t.carId,
        isPlayer: Boolean(t.isPlayer),
        frameCount,
        posesBuf: flat.buffer,
      }
    }),
  }
}

function unpackReplayData(packed) {
  if (!packed) return null
  if (Array.isArray(packed.times) && Array.isArray(packed.tracks) && !packed.timesBuf) {
    return packed
  }
  const timesArr = Array.from(new Float32Array(packed.timesBuf), t => Math.round(t * 10) / 10)
  const tracks = (packed.tracks || []).map(t => {
    const flat = new Float32Array(t.posesBuf)
    const count = t.frameCount ?? Math.floor(flat.length / 35)
    const poses = new Array(count)
    for (let i = 0; i < count; i++) {
      poses[i] = flat.subarray(i * 35, (i + 1) * 35)
    }
    return {
      name: t.name,
      carId: t.carId,
      isPlayer: Boolean(t.isPlayer),
      poses,
    }
  })
  return {
    version: packed.version || 1,
    recordedAt: packed.recordedAt,
    duration: packed.duration,
    cuts: packed.cuts || [],
    ...(packed.clip ? { clip: packed.clip } : {}),
    times: timesArr,
    tracks,
  }
}

function replayDataToJsonObject(data) {
  const unpacked = unpackReplayData(data)
  return {
    version: unpacked.version || 1,
    recordedAt: unpacked.recordedAt || new Date().toISOString(),
    duration: Math.round(unpacked.duration || 0),
    cuts: unpacked.cuts || [],
    ...(unpacked.clip ? { clip: unpacked.clip } : {}),
    times: unpacked.times,
    tracks: unpacked.tracks.map(t => ({
      name: t.name,
      carId: t.carId,
      isPlayer: Boolean(t.isPlayer),
      poses: t.poses.map(pose => Array.from(pose, (v, idx) => {
        const scale = (idx % 7) < 3 ? 1000 : 100000
        return Math.round(v * scale) / scale
      })),
    })),
  }
}

function captureThumbnail(scene, width = 320) {
  const renderer = scene?.renderer
  const srcCanvas = renderer?.domElement
  if (!srcCanvas || !srcCanvas.width || !srcCanvas.height) return null
  renderer.render(scene.scene, scene.camera)
  const aspect = srcCanvas.height / srcCanvas.width
  const height = Math.max(90, Math.round(width * aspect))
  const thumb = document.createElement('canvas')
  thumb.width = width
  thumb.height = height
  const ctx = thumb.getContext('2d')
  ctx.drawImage(srcCanvas, 0, 0, width, height)
  return thumb.toDataURL('image/jpeg', 0.72)
}

async function saveReplay(input) {
  const db = await openReplayDb()
  const now = Date.now()
  const id = input.id || `rec_${now}_${Math.random().toString(36).slice(2, 7)}`
  const createdAt = Number(input.createdAt) || now
  const rawData = input.data
  if (!rawData) throw new Error('saveReplay requires replay data')

  const durationMs = Number(input.durationMs ?? rawData.duration) || (rawData.times?.length ? rawData.times[rawData.times.length - 1] : 0)
  const tracks = rawData.tracks || []
  const carCount = Number(input.carCount) || tracks.length || 1
  const playerTrack = tracks[0] || {}
  const playerCarId = input.playerCarId || playerTrack.carId || 'mustang'
  const playerName = input.playerName || playerTrack.name || 'Player'
  const laps = input.laps ?? null
  const place = input.place ?? null

  const record = {
    id,
    createdAt,
    name: input.name || formatDefaultName({ laps, place, createdAt, playerCarId }),
    starred: Boolean(input.starred),
    durationMs: Math.round(durationMs),
    carCount,
    playerCarId,
    playerName,
    laps,
    place,
    thumbnail: input.thumbnail || null,
    data: packReplayData(rawData),
  }

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })

  await pruneReplays({ keep: DEFAULT_KEEP })
  return stripData(record)
}

async function listReplays() {
  const db = await openReplayDb()
  const records = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
  records.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  return records.map(stripData)
}

async function getReplay(id) {
  const db = await openReplayDb()
  const record = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(id)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
  if (!record) return null
  return {
    ...record,
    data: unpackReplayData(record.data),
  }
}

async function getLatestReplay() {
  const list = await listReplays()
  if (!list.length) return null
  return getReplay(list[0].id)
}

async function updateReplay(id, patch = {}) {
  const db = await openReplayDb()
  const existing = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(id)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
  if (!existing) return null

  if (patch.name !== undefined) existing.name = String(patch.name).trim() || existing.name
  if (patch.starred !== undefined) existing.starred = Boolean(patch.starred)
  if (patch.thumbnail !== undefined) existing.thumbnail = patch.thumbnail
  if (patch.data) {
    existing.data = packReplayData(patch.data)
    if (patch.data.duration !== undefined) existing.durationMs = Math.round(patch.data.duration)
  } else if (existing.data) {
    if (patch.cuts !== undefined) existing.data.cuts = patch.cuts
    if (patch.clip !== undefined) {
      if (patch.clip) existing.data.clip = patch.clip
      else delete existing.data.clip
    }
  }

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(existing)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })

  return stripData(existing)
}

async function deleteReplay(id) {
  const db = await openReplayDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  return true
}

async function pruneReplays({ keep = DEFAULT_KEEP } = {}) {
  const all = await listReplays()
  const unstarred = all.filter(r => !r.starred)
  if (unstarred.length <= keep) return []
  const toDelete = unstarred.slice(keep)
  for (const item of toDelete) {
    await deleteReplay(item.id)
  }
  return toDelete.map(r => r.id)
}

export {
  saveReplay,
  listReplays,
  getReplay,
  getLatestReplay,
  updateReplay,
  deleteReplay,
  pruneReplays,
  captureThumbnail,
  replayDataToJsonObject,
}
