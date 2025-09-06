export class ReplayRecorder {
  constructor() {
    this.isRecording = false;
    this.frames = [];
    this.startTime = 0;
  }

  start() {
    this.isRecording = true;
    this.frames = [];
    this.startTime = performance.now();
  }

  stop() {
    this.isRecording = false;
    return this.frames;
  }

  recordFrame(car) {
    if (!this.isRecording) return;
    
    try {
      const timestamp = performance.now() - this.startTime;
      const frame = {
        timestamp,
        position: car.chassis.position.clone(),
        rotation: car.chassis.quaternion.clone(),
        velocity: car.chassis.body.velocity.clone()
      };
      
      this.frames.push(frame);
    } catch (error) {
      console.error('Error recording frame:', error);
    }
  }
}

export class ReplayPlayer {
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
  }

  play() {
    if (this.frames.length === 0) return;
    this.isPlaying = true;
    this.startTime = performance.now();
  }

  pause() {
    this.isPlaying = false;
  }

  stop() {
    this.isPlaying = false;
    this.currentFrame = 0;
  }

  seek(time) {
    // Find frame closest to time
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

      // Find current frame
      while (this.currentFrame < this.frames.length - 1 && 
             this.frames[this.currentFrame + 1].timestamp <= targetTime) {
        this.currentFrame++;
      }

      if (this.currentFrame >= this.frames.length) {
        this.stop();
        return;
      }

      const frame = this.frames[this.currentFrame];
      
      // Apply frame data to car
      car.chassis.position.copy(frame.position);
      car.chassis.quaternion.copy(frame.rotation);
      car.chassis.body.velocity.copy(frame.velocity);
    } catch (error) {
      console.error('Error updating replay:', error);
      this.stop();
    }
  }
}


export class ReplayUI {
  constructor() {
    this.isVisible = false;
    this.createUI();
  }

  createUI() {
    // Simple replay controls panel
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

    // Play/Pause button
    this.playBtn = document.createElement('button');
    this.playBtn.textContent = '▶';
    this.playBtn.style.cssText = 'margin: 0 5px; padding: 5px 10px;';

    // Timeline
    this.timeline = document.createElement('input');
    this.timeline.type = 'range';
    this.timeline.min = '0';
    this.timeline.max = '100';
    this.timeline.value = '0';
    this.timeline.style.cssText = 'width: 200px; margin: 0 10px;';

    // Time display
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
