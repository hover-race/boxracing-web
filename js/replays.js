class ReplayRecorder {
  constructor() {
    this.isRecording = false;
    this.frames = [];
    this.startTime = 0;
  }

  start() {
    this.isRecording = true;
    this.frames = [];
    this.startTime = performance.now();
    console.log('ReplayRecorder: Recording started');
  }

  stop() {
    this.isRecording = false;
    console.log('ReplayRecorder: Recording stopped, captured', this.frames.length, 'frames');
    return this.frames;
  }

  recordFrame(car) {
    if (!this.isRecording) return;
    
    try {
      const timestamp = performance.now() - this.startTime;
      
      // Get velocity from Ammo.js body and convert to Three.js Vector3
      const ammoVelocity = car.chassis.body.ammo.getLinearVelocity();
      const velocity = new THREE.Vector3(ammoVelocity.x(), ammoVelocity.y(), ammoVelocity.z());
      
      const frame = {
        timestamp,
        position: car.chassis.position.clone(),
        rotation: car.chassis.quaternion.clone(),
        velocity: velocity.clone()
      };
      
      this.frames.push(frame);
    } catch (error) {
      console.error('Error recording frame:', error);
    }
  }
}

class ReplayPlayer {
  constructor() {
    this.isPlaying = false;
    this.frames = [];
    this.currentFrame = 0;
    this.playbackSpeed = 1.0;
    this.startTime = 0;
  }

  load(frames) {
    this.frames = frames;
    this.currentFrame = 0;
    console.log('ReplayPlayer: Loaded', frames.length, 'frames');
  }

  play(car) {
    if (this.frames.length === 0) return;
    this.isPlaying = true;
    this.startTime = performance.now();
    // Disable physics on the chassis so replay positions aren't overridden
    if (car && car.chassis && car.chassis.body) {
      this._savedCollisionFlags = car.chassis.body.ammo.getCollisionFlags();
      // CF_KINEMATIC_OBJECT = 2
      car.chassis.body.ammo.setCollisionFlags(this._savedCollisionFlags | 2);
      car.chassis.body.ammo.setActivationState(4); // DISABLE_DEACTIVATION
      car.chassis.body.skipUpdate = true;
      const zero = new Ammo.btVector3(0, 0, 0);
      car.chassis.body.ammo.setLinearVelocity(zero);
      car.chassis.body.ammo.setAngularVelocity(zero);
    }
    console.log('ReplayPlayer: Playback started');
  }

  pause() {
    this.isPlaying = false;
    console.log('ReplayPlayer: Playback paused');
  }

  stop(car) {
    this.isPlaying = false;
    this.currentFrame = 0;
    // Restore physics on the chassis
    if (car && car.chassis && car.chassis.body && this._savedCollisionFlags !== undefined) {
      car.chassis.body.ammo.setCollisionFlags(this._savedCollisionFlags);
      car.chassis.body.ammo.setActivationState(1); // ACTIVE_TAG
      car.chassis.body.skipUpdate = false;
      this._savedCollisionFlags = undefined;
    }
    console.log('ReplayPlayer: Playback stopped');
  }

  seek(time) {
    for (let i = 0; i < this.frames.length; i++) {
      if (this.frames[i].timestamp >= time) {
        this.currentFrame = i;
        break;
      }
    }
  }

  update(car) {
    if (!this.isPlaying || this.frames.length === 0) return;

    try {
      const currentTime = (performance.now() - this.startTime) * this.playbackSpeed;
      const targetTime = currentTime;

      while (this.currentFrame < this.frames.length - 1 && 
             this.frames[this.currentFrame + 1].timestamp <= targetTime) {
        this.currentFrame++;
      }

      if (this.currentFrame >= this.frames.length) {
        this.stop(car);
        return;
      }

      const frame = this.frames[this.currentFrame];

      // Update the physics transform directly so the kinematic body moves
      const transform = car.chassis.body.ammo.getWorldTransform();
      transform.getOrigin().setValue(frame.position.x, frame.position.y, frame.position.z);
      const q = frame.rotation;
      transform.setRotation(new Ammo.btQuaternion(q.x, q.y, q.z, q.w));
      car.chassis.body.ammo.setWorldTransform(transform);

      // Also sync the Three.js mesh
      car.chassis.position.copy(frame.position);
      car.chassis.quaternion.copy(frame.rotation);
    } catch (error) {
      console.error('Error updating replay:', error);
      this.stop();
    }
  }
}

const CameraMode = Object.freeze({
  FOLLOW: 'follow',
  OVERHEAD: 'overhead',
})

class CameraSwitcher {
  constructor(scene) {
    this.scene = scene
    this.mode = CameraMode.FOLLOW
    this.overheadHeight = 30
    this.overheadSmooth = 0.05
    this.createUI()
  }

  createUI() {
    this.panel = document.createElement('div')
    this.panel.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 8px;
      z-index: 1000;
    `

    const btnStyle = (active) => `
      padding: 8px 16px;
      border: 1px solid #666;
      border-radius: 6px;
      color: #fff;
      font-family: monospace;
      font-size: 14px;
      cursor: pointer;
      background: ${active ? 'rgba(78, 205, 196, 0.8)' : 'rgba(0, 0, 0, 0.7)'};
    `

    this.followBtn = document.createElement('button')
    this.followBtn.textContent = 'Follow Cam'
    this.followBtn.style.cssText = btnStyle(true)
    this.followBtn.onclick = () => this.setMode(CameraMode.FOLLOW)

    this.overheadBtn = document.createElement('button')
    this.overheadBtn.textContent = 'Overhead Cam'
    this.overheadBtn.style.cssText = btnStyle(false)
    this.overheadBtn.onclick = () => this.setMode(CameraMode.OVERHEAD)

    this.panel.appendChild(this.followBtn)
    this.panel.appendChild(this.overheadBtn)
    document.body.appendChild(this.panel)
  }

  setMode(mode) {
    this.mode = mode

    const activeStyle = 'rgba(78, 205, 196, 0.8)'
    const inactiveStyle = 'rgba(0, 0, 0, 0.7)'

    this.followBtn.style.background = mode === CameraMode.FOLLOW ? activeStyle : inactiveStyle
    this.overheadBtn.style.background = mode === CameraMode.OVERHEAD ? activeStyle : inactiveStyle
  }

  updateCamera(camera, target, deltaTime) {
    if (!target) return

    if (this.mode === CameraMode.OVERHEAD) {
      // Overhead: look straight down, follow target XZ
      const tx = target.position.x
      const tz = target.position.z
      camera.position.x += (tx - camera.position.x) * this.overheadSmooth
      camera.position.z += (tz - camera.position.z) * this.overheadSmooth
      camera.position.y += (this.overheadHeight - camera.position.y) * this.overheadSmooth
      camera.lookAt(camera.position.x, 0, camera.position.z)
    }
    // 'follow' mode is handled by the existing CameraSmoothFollow
  }
}

class ReplayUI {
  constructor() {
    this.isVisible = false;
    this.createUI();
  }

  createUI() {
    this.panel = document.createElement('div');
    this.panel.id = 'replay-controls';
    this.panel.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      padding: 10px;
      border-radius: 8px;
      display: none;
      z-index: 1000;
    `;

    this.playBtn = document.createElement('button');
    this.playBtn.textContent = '▶';
    this.playBtn.style.cssText = 'margin: 0 5px; padding: 5px 10px;';

    this.timeline = document.createElement('input');
    this.timeline.type = 'range';
    this.timeline.min = '0';
    this.timeline.max = '100';
    this.timeline.value = '0';
    this.timeline.style.cssText = 'width: 200px; margin: 0 10px;';

    this.timeDisplay = document.createElement('span');
    this.timeDisplay.textContent = '0:00 / 0:00';
    this.timeDisplay.style.cssText = 'color: white; font-family: monospace; margin: 0 10px;';

    this.panel.appendChild(this.playBtn);
    this.panel.appendChild(this.timeline);
    this.panel.appendChild(this.timeDisplay);
    document.body.appendChild(this.panel);
  }

  show() {
    this.isVisible = true;
    this.panel.style.display = 'block';
  }

  hide() {
    this.isVisible = false;
    this.panel.style.display = 'none';
  }

  updateTime(current, total) {
    const formatTime = (ms) => {
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
    };
    
    this.timeDisplay.textContent = `${formatTime(current)} / ${formatTime(total)}`;
    this.timeline.value = total > 0 ? (current / total) * 100 : 0;
  }
}

export { ReplayRecorder, ReplayPlayer, ReplayUI, CameraMode, CameraSwitcher };
