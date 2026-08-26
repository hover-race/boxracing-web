import { on } from './raceEvents.js'
import { gravityFromMotion, gravityFromOrientation, screenRoll } from './tilt.js'

class ControlsManager {
  constructor(scene) {
    this.scene = scene;
    this.pad = { up: false, down: false, left: false, right: false, handbrake: false };
    
    this.clearInputs();
    
    // Initialize all control methods
    this.setupKeyboardControls();
    this.setupTouchControls();
    this.setupTiltControls();
    this.setupRaceInputGate();
  }

  clearInputs() {
    inputControls.steering = 0;
    inputControls.throttle = 0;
    inputControls.brake = 0;
    inputControls.handbrake = 0;
  }

  setupRaceInputGate() {
    on('countdownStart', () => {
      inputControls.enabled = false;
      this.clearInputs();
    });
    on('raceStart', () => {
      inputControls.enabled = true;
    });
  }
  
  setupKeyboardControls() {
    const isEditable = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };

    const keyEvent = (e, down) => {
      if (!inputControls.enabled) {
        if (e.code === 'KeyW' || e.code === 'ArrowUp') {
          inputControls.throttle = down ? 1 : 0;
          e.preventDefault();
        }
        return;
      }
      // Don't drive the car while typing into a GUI field; let the input keep the event.
      if (isEditable(e.target)) return;

      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          inputControls.throttle = down ? 1 : 0;
          break;
        case 'KeyA':
        case 'ArrowLeft': 
          inputControls.steering = down ? -1 : 0;
          break;
        case 'KeyS':
        case 'ArrowDown':
          inputControls.brake = down ? 1 : 0;
          break;
        case 'KeyD':
        case 'ArrowRight':
          inputControls.steering = down ? 1 : 0;
          break;
        case 'Space':
          inputControls.handbrake = down ? 1 : 0;
          break;
        default:
          return;
      }
      // The game consumed this key; stop browser defaults (page scroll, etc.).
      e.preventDefault();
    };
    
    document.addEventListener('keydown', e => keyEvent(e, true));
    document.addEventListener('keyup', e => keyEvent(e, false));
  }
  
  setupTouchControls() {
    const pad = document.getElementById('mobile-controls')
    if (!pad) return
    pad.addEventListener('contextmenu', (e) => e.preventDefault())
    const arrowPad = document.getElementById('arrow-pad')
    const PAD_DIM_MS = 3000
    const padHeld = () => this.pad.up || this.pad.down || this.pad.left || this.pad.right
    const wakeArrows = () => {
      arrowPad.classList.remove('is-dim')
      clearTimeout(this._padDimTimer)
    }
    const scheduleDimArrows = () => {
      if (padHeld()) return
      clearTimeout(this._padDimTimer)
      this._padDimTimer = setTimeout(() => arrowPad.classList.add('is-dim'), PAD_DIM_MS)
    }

    const syncPad = () => {
      inputControls.throttle = this.pad.up ? 1 : 0
      if (!inputControls.enabled) {
        inputControls.steering = 0
        inputControls.brake = 0
        inputControls.handbrake = 0
        return
      }
      inputControls.brake = this.pad.down ? 1 : 0
      inputControls.handbrake = this.pad.handbrake ? 1 : 0
      if (this.pad.left || this.pad.right) {
        inputControls.steering = (this.pad.right ? 1 : 0) - (this.pad.left ? 1 : 0)
      } else if (!params.tiltSteering) {
        inputControls.steering = 0
      }
    }

    const setPad = (dir, down, button) => {
      this.pad[dir] = down
      button.classList.toggle('is-down', down)
      if (dir !== 'handbrake') {
        if (down) wakeArrows()
        else scheduleDimArrows()
      }
      syncPad()
    }

    for (const button of pad.querySelectorAll('[data-pad]')) {
      const dir = button.dataset.pad
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        button.setPointerCapture(e.pointerId)
        setPad(dir, true, button)
      })
      button.addEventListener('pointerup', () => setPad(dir, false, button))
      button.addEventListener('pointercancel', () => setPad(dir, false, button))
    }
    scheduleDimArrows()
  }
  
  setupTiltControls() {
    this.onDeviceMotion = (event) => {
      const g = gravityFromMotion(event)
      if (!g) return
      this._tiltFromMotion = true
      this.applyScreenRoll(g.gx, g.gy)
    }
    this.onDeviceOrientation = (event) => {
      if (this._tiltFromMotion) return
      const g = gravityFromOrientation(event)
      this.applyScreenRoll(g.gx, g.gy)
    }
    window.addEventListener('devicemotion', this.onDeviceMotion)
    window.addEventListener('deviceorientation', this.onDeviceOrientation)
  }

  applyScreenRoll(gx, gy) {
    if (!params.tiltSteering || !inputControls.enabled) return
    if (this.pad.left || this.pad.right) return
    inputControls.steering = screenRoll(gx, gy, params.tiltSensitivity).steering
  }

  cleanup() {
    window.removeEventListener('devicemotion', this.onDeviceMotion)
    window.removeEventListener('deviceorientation', this.onDeviceOrientation)
  }

  update() {}
}

export { ControlsManager }; 