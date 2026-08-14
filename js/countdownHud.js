import { on } from './raceEvents.js'

const el = document.getElementById('race-countdown')
if (!el) throw new Error('race-countdown element missing')

on('countdownStart', () => {
  el.classList.remove('fade-out')
  el.classList.add('visible')
})

on('countdown', (n) => {
  el.textContent = n === 0 ? 'GO!' : `Race in ${n}`
})

on('raceStart', () => {
  setTimeout(() => {
    el.classList.add('fade-out')
  }, 400)
  const onEnd = (e) => {
    if (e.propertyName !== 'opacity') return
    el.classList.remove('visible', 'fade-out')
    el.removeEventListener('transitionend', onEnd)
  }
  el.addEventListener('transitionend', onEnd)
})
