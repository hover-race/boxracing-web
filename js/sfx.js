// Procedural impact / explosion sounds (Web Audio, no assets).
// Volume follows params.soundVolume like the engine sound.

let ctx = null
let noiseBuffer = null

function ensureContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)()
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

function masterVolume() {
  return params.soundVolume / 100
}

// Deep boom: lowpass-swept noise burst plus a sub-bass sine drop.
function playExplosionSound() {
  const ac = ensureContext()
  const t = ac.currentTime
  const out = ac.createGain()
  out.gain.value = 0.9 * masterVolume()
  out.connect(ac.destination)

  const noise = ac.createBufferSource()
  noise.buffer = noiseBuffer
  const filter = ac.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(2500, t)
  filter.frequency.exponentialRampToValueAtTime(80, t + 1.1)
  const noiseGain = ac.createGain()
  noiseGain.gain.setValueAtTime(1, t)
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 1.2)
  noise.connect(filter).connect(noiseGain).connect(out)
  noise.start(t)
  noise.stop(t + 1.3)

  const sub = ac.createOscillator()
  sub.type = 'sine'
  sub.frequency.setValueAtTime(90, t)
  sub.frequency.exponentialRampToValueAtTime(28, t + 0.7)
  const subGain = ac.createGain()
  subGain.gain.setValueAtTime(0.8, t)
  subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.8)
  sub.connect(subGain).connect(out)
  sub.start(t)
  sub.stop(t + 0.9)
}

// Short metallic thud for smaller collisions; intensity 0..1 scales volume and length.
function playImpactSound(intensity = 1) {
  const ac = ensureContext()
  const t = ac.currentTime
  const dur = 0.12 + 0.18 * intensity
  const out = ac.createGain()
  out.gain.value = (0.25 + 0.55 * intensity) * masterVolume()
  out.connect(ac.destination)

  const noise = ac.createBufferSource()
  noise.buffer = noiseBuffer
  const filter = ac.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(900 + 600 * intensity, t)
  filter.frequency.exponentialRampToValueAtTime(120, t + dur)
  const noiseGain = ac.createGain()
  noiseGain.gain.setValueAtTime(1, t)
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t + dur)
  noise.connect(filter).connect(noiseGain).connect(out)
  noise.start(t)
  noise.stop(t + dur + 0.05)

  const thump = ac.createOscillator()
  thump.type = 'sine'
  thump.frequency.setValueAtTime(120, t)
  thump.frequency.exponentialRampToValueAtTime(50, t + dur)
  const thumpGain = ac.createGain()
  thumpGain.gain.setValueAtTime(0.6, t)
  thumpGain.gain.exponentialRampToValueAtTime(0.001, t + dur)
  thump.connect(thumpGain).connect(out)
  thump.start(t)
  thump.stop(t + dur + 0.05)
}

export { playExplosionSound, playImpactSound }
