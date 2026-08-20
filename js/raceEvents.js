const listeners = new Map()
let raceStarted = false

function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set())
  listeners.get(event).add(fn)
}

function off(event, fn) {
  listeners.get(event)?.delete(fn)
}

function emit(event, detail) {
  if (event === 'countdownStart') raceStarted = false
  if (event === 'raceStart') raceStarted = true
  for (const fn of listeners.get(event) ?? []) fn(detail)
}

function isRaceStarted() {
  return raceStarted
}

export { on, off, emit, isRaceStarted }
