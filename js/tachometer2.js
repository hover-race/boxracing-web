import { Tachometer } from './tachometer.js'

class Tachometer2 extends Tachometer {
  constructor(element, redline) {
    super(element, redline, true)
  }
}

export { Tachometer2 }
