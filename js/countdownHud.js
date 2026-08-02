import { on } from './raceEvents.js'

const el = document.getElementById('race-countdown')
if (!el) throw new Error('race-countdown element missing')

on('countdownStart', () => {
  el.classList.add('visible')
})

on('countdown', (n) => {
  el.textContent = n === 0 ? 'GO!' : String(n)
})

on('raceStart', () => {
  el.classList.remove('visible')
})
