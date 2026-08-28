const MIN_ANGLE = -135
const MAX_ANGLE = 135
const MAX_RPM = 8000
const SVG_NS = 'http://www.w3.org/2000/svg'

function point(radius, angle) {
  const radians = angle * Math.PI / 180
  return {
    x: 110 + Math.sin(radians) * radius,
    y: 110 - Math.cos(radians) * radius,
  }
}

class Tachometer {
  constructor(element, redline) {
    this.needle = element.querySelector('[data-tach-needle]')
    this.gear = element.querySelector('[data-tach-gear]')
    this.speedValue = element.querySelector('[data-tach-speed]')
    const ticks = element.querySelector('[data-tach-ticks]')
    const numbers = element.querySelector('[data-tach-numbers]')

    for (let rpm = 0; rpm <= MAX_RPM; rpm += 250) {
      const angle = MIN_ANGLE + (rpm / MAX_RPM) * (MAX_ANGLE - MIN_ANGLE)
      const major = rpm % 1000 === 0
      const outer = point(91, angle)
      const inner = point(major ? 77 : 83, angle)
      const tick = document.createElementNS(SVG_NS, 'line')
      tick.setAttribute('x1', inner.x)
      tick.setAttribute('y1', inner.y)
      tick.setAttribute('x2', outer.x)
      tick.setAttribute('y2', outer.y)
      tick.setAttribute('class', `tach-tick${major ? ' major' : ''}${rpm >= redline ? ' redline' : ''}`)
      ticks.appendChild(tick)

      if (major) {
        const labelPoint = point(66, angle)
        const label = document.createElementNS(SVG_NS, 'text')
        label.setAttribute('x', labelPoint.x)
        label.setAttribute('y', labelPoint.y)
        label.setAttribute('class', 'tach-number')
        label.textContent = rpm / 1000
        numbers.appendChild(label)
      }
    }

    const redlineStart = point(96, MIN_ANGLE + (redline / MAX_RPM) * (MAX_ANGLE - MIN_ANGLE))
    const redlineEnd = point(96, MAX_ANGLE)
    element.querySelector('[data-tach-redline]').setAttribute(
      'd',
      `M ${redlineStart.x} ${redlineStart.y} A 96 96 0 0 1 ${redlineEnd.x} ${redlineEnd.y}`,
    )
  }

  update(rpm, gear, speedMph = 0) {
    const clampedRpm = Math.max(0, Math.min(MAX_RPM, rpm))
    const angle = MIN_ANGLE + (clampedRpm / MAX_RPM) * (MAX_ANGLE - MIN_ANGLE)
    this.needle.style.transform = `rotate(${angle}deg)`
    this.gear.textContent = gear
    if (this.speedValue) {
      this.speedValue.textContent = Math.abs(speedMph).toFixed(0)
    }
  }
}

export { Tachometer }
