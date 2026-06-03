const TIRE_SCREECH_URL = 'assets/tire-screech2.mp3'
const TIRE_VOLUME_GAIN = 2.5

export function loadTireScreechBuffer(audioListener) {
  const sound = new THREE.Audio(audioListener)
  const loader = new THREE.AudioLoader()
  return new Promise((resolve, reject) => {
    loader.load(
      TIRE_SCREECH_URL,
      (buffer) => {
        sound.setBuffer(buffer)
        sound.setLoop(true)
        resolve(sound)
      },
      undefined,
      reject,
    )
  })
}

export class TireScreechSound {
  constructor(audioListener) {
    this.audioUnlocked = false
    this.volumeSmoothed = 0
    this.sound = null

    if (!audioListener) return

    loadTireScreechBuffer(audioListener).then((sound) => {
      this.sound = sound
    })
  }

  enableOnFirstGesture() {
    const unlock = () => {
      this.audioUnlocked = true
    }
    document.addEventListener('mousedown', unlock, { once: true })
    document.addEventListener('touchstart', unlock, { once: true })
    document.addEventListener('keydown', unlock, { once: true })
  }

  update(intensity, dt) {
    const sound = this.sound
    if (!sound || !sound.buffer) return

    const targetVolume = Math.min(1, intensity * (params.soundVolume / 100) * TIRE_VOLUME_GAIN)
    const smoothRate = 10
    this.volumeSmoothed += (targetVolume - this.volumeSmoothed) * Math.min(1, smoothRate * dt)
    sound.setVolume(this.volumeSmoothed)

    const minPitch = 0.95
    const maxPitch = 1.08
    sound.setPlaybackRate(minPitch + (maxPitch - minPitch) * intensity)

    if (intensity > 0.02 && this.audioUnlocked) {
      if (!sound.isPlaying) sound.play()
    } else if (sound.isPlaying) {
      sound.pause()
    }
  }
}
