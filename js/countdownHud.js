import { on } from './raceEvents.js'

const el = document.getElementById('race-countdown')
if (!el) throw new Error('race-countdown element missing')
const finish = document.getElementById('race-finish')
const finishNext = document.getElementById('race-finish-next')

on('countdownStart', () => {
  el.classList.remove('fade-out', 'next-round')
  if (finish?.classList.contains('visible')) {
    el.classList.remove('visible')
    return
  }
  el.classList.add('visible')
})

on('nextRound', (n) => {
  const text = `Next round in ${n}`
  if (finish?.classList.contains('visible') && finishNext) {
    finishNext.textContent = text
    return
  }
  el.classList.remove('fade-out')
  el.classList.add('visible', 'next-round')
  el.textContent = text
})

on('countdown', (n) => {
  el.classList.remove('next-round')
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
