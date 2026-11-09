import {
  saveReplay,
  listReplays,
  getReplay,
  updateReplay,
  deleteReplay,
  replayDataToJsonObject,
} from './replayStore.js'

function formatDuration(ms) {
  const clamped = Math.max(0, Number(ms) || 0)
  const totalSec = Math.floor(clamped / 1000)
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  const tenths = Math.floor((clamped % 1000) / 100)
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`
}

function formatDate(ts) {
  const d = new Date(ts || Date.now())
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function downloadJsonBlob(obj, filename) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function playRecordingById(id) {
  const url = new URL(window.location.href)
  url.searchParams.set('replay', `rec:${id}`)
  url.searchParams.set('skipIntro', '1')
  window.location.assign(url)
}

class RecordingsBrowser {
  constructor() {
    this.panel = null
    this.listEl = null
    this.emptyEl = null
    this.fileInput = null
    this.isOpen = false
    this._mounted = false
  }

  _ensureDom() {
    if (this._mounted) return
    this._mounted = true

    this.panel = document.getElementById('recordings-modal')
    if (!this.panel) {
      const modal = document.createElement('div')
      modal.id = 'recordings-modal'
      modal.hidden = true
      modal.innerHTML = `
        <div id="recordings-backdrop"></div>
        <div id="recordings-dialog" role="dialog" aria-modal="true" aria-labelledby="recordings-title">
          <div id="recordings-header">
            <h2 id="recordings-title">Recordings</h2>
            <div id="recordings-header-actions">
              <button type="button" id="recordings-sample-btn" title="Watch built-in 4-car sample replay">▶ Sample Replay</button>
              <button type="button" id="recordings-import-btn" title="Import replay .json file">Import JSON</button>
              <input type="file" id="recordings-import-input" accept=".json,application/json" hidden>
              <button type="button" id="recordings-close-btn" aria-label="Close">✕</button>
            </div>
          </div>
          <div id="recordings-drop-hint">Drop a replay <code>.json</code> file anywhere here to import</div>
          <div id="recordings-empty" hidden>No saved recordings yet. Race a lap or import a replay JSON file.</div>
          <div id="recordings-list"></div>
        </div>
      `
      document.body.appendChild(modal)
      this.panel = modal
    }

    this.listEl = document.getElementById('recordings-list')
    this.emptyEl = document.getElementById('recordings-empty')
    this.fileInput = document.getElementById('recordings-import-input')
    const dialog = document.getElementById('recordings-dialog')

    document.getElementById('recordings-backdrop')?.addEventListener('click', () => this.close())
    document.getElementById('recordings-close-btn')?.addEventListener('click', () => this.close())
    document.getElementById('recordings-import-btn')?.addEventListener('click', () => this.fileInput?.click())
    document.getElementById('recordings-sample-btn')?.addEventListener('click', () => {
      const url = new URL(window.location.href)
      url.searchParams.set('replay', 'replays/sample-race.json')
      url.searchParams.set('skipIntro', '1')
      window.location.assign(url)
    })

    this.fileInput?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0]
      if (!file) return
      const text = await file.text()
      const data = JSON.parse(text)
      await this.importJson(data, file.name.replace(/\.json$/i, ''))
      e.target.value = ''
    })

    dialog?.addEventListener('dragover', (e) => {
      e.preventDefault()
      dialog.classList.add('drag-over')
    })
    dialog?.addEventListener('dragleave', (e) => {
      if (!dialog.contains(e.relatedTarget)) dialog.classList.remove('drag-over')
    })
    dialog?.addEventListener('drop', async (e) => {
      e.preventDefault()
      dialog.classList.remove('drag-over')
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      const text = await file.text()
      const data = JSON.parse(text)
      await this.importJson(data, file.name.replace(/\.json$/i, ''))
    })

    window.addEventListener('keydown', (e) => {
      if (this.isOpen && e.code === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.close()
      }
    })
  }

  async open() {
    this._ensureDom()
    this.isOpen = true
    this.panel.hidden = false
    await this.refresh()
  }

  close() {
    if (!this.panel) return
    this.isOpen = false
    this.panel.hidden = true
  }

  toggle() {
    if (this.isOpen) this.close()
    else this.open()
  }

  async importJson(data, name) {
    const saved = await saveReplay({
      name: name || undefined,
      data,
    })
    if (this.isOpen) await this.refresh()
    return saved
  }

  async refresh() {
    this._ensureDom()
    const items = await listReplays()
    this.listEl.replaceChildren()
    if (!items.length) {
      this.emptyEl.hidden = false
      return items
    }
    this.emptyEl.hidden = true

    for (const item of items) {
      const row = document.createElement('div')
      row.className = 'recording-row'
      row.dataset.id = item.id

      const thumbWrap = document.createElement('div')
      thumbWrap.className = 'recording-thumb'
      if (item.thumbnail) {
        const img = document.createElement('img')
        img.src = item.thumbnail
        img.alt = item.name
        thumbWrap.appendChild(img)
      } else {
        thumbWrap.textContent = '🎬'
      }
      thumbWrap.addEventListener('click', () => playRecordingById(item.id))

      const info = document.createElement('div')
      info.className = 'recording-info'

      const nameInput = document.createElement('input')
      nameInput.type = 'text'
      nameInput.className = 'recording-name-input'
      nameInput.value = item.name || item.id
      nameInput.title = 'Click to rename recording'
      nameInput.addEventListener('change', async () => {
        const nextName = nameInput.value.trim()
        if (nextName && nextName !== item.name) {
          await updateReplay(item.id, { name: nextName })
          item.name = nextName
        } else {
          nameInput.value = item.name
        }
      })
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') nameInput.blur()
      })

      const meta = document.createElement('div')
      meta.className = 'recording-meta'
      const bits = [
        formatDate(item.createdAt),
        formatDuration(item.durationMs),
        `${item.carCount || 1} ${(item.carCount || 1) === 1 ? 'car' : 'cars'}`,
        item.playerCarId || 'mustang',
      ]
      if (item.place) bits.push(`P${item.place}`)
      if (item.laps) bits.push(`${item.laps}L`)
      meta.textContent = bits.join(' · ')

      info.append(nameInput, meta)

      const actions = document.createElement('div')
      actions.className = 'recording-actions'

      const playBtn = document.createElement('button')
      playBtn.type = 'button'
      playBtn.className = 'recording-play-btn'
      playBtn.textContent = '▶ Play'
      playBtn.addEventListener('click', () => playRecordingById(item.id))

      const starBtn = document.createElement('button')
      starBtn.type = 'button'
      starBtn.className = `recording-star-btn${item.starred ? ' starred' : ''}`
      starBtn.textContent = item.starred ? '★' : '☆'
      starBtn.title = item.starred ? 'Starred (protected from auto-prune)' : 'Star recording'
      starBtn.addEventListener('click', async () => {
        const next = !item.starred
        await updateReplay(item.id, { starred: next })
        item.starred = next
        starBtn.classList.toggle('starred', next)
        starBtn.textContent = next ? '★' : '☆'
      })

      const dlBtn = document.createElement('button')
      dlBtn.type = 'button'
      dlBtn.textContent = 'JSON'
      dlBtn.title = 'Download replay JSON'
      dlBtn.addEventListener('click', async () => {
        const full = await getReplay(item.id)
        if (!full) return
        const safeName = (full.name || full.id).replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()
        downloadJsonBlob(replayDataToJsonObject(full.data), `${safeName || 'replay'}.json`)
      })

      const delBtn = document.createElement('button')
      delBtn.type = 'button'
      delBtn.className = 'recording-del-btn'
      delBtn.textContent = '🗑'
      delBtn.title = 'Delete recording'
      delBtn.addEventListener('click', async () => {
        if (!window.confirm(`Delete recording "${item.name}"?`)) return
        await deleteReplay(item.id)
        await this.refresh()
      })

      actions.append(playBtn, starBtn, dlBtn, delBtn)
      row.append(thumbWrap, info, actions)
      this.listEl.appendChild(row)
    }
    return items
  }
}

const recordingsBrowser = new RecordingsBrowser()

document.getElementById('car-selection-recordings')?.addEventListener('click', (e) => {
  e.preventDefault()
  e.stopPropagation()
  recordingsBrowser.open()
})

window.openRecordingsBrowser = () => recordingsBrowser.open()
window.__replays = {
  list: () => listReplays(),
  get: (id) => getReplay(id),
  play: (id) => playRecordingById(id),
  rename: (id, name) => updateReplay(id, { name }),
  star: (id, starred = true) => updateReplay(id, { starred: Boolean(starred) }),
  remove: (id) => deleteReplay(id),
  importJson: (data, name) => recordingsBrowser.importJson(data, name),
  open: () => recordingsBrowser.open(),
  close: () => recordingsBrowser.close(),
}

export { recordingsBrowser, playRecordingById }
