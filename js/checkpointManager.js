class CheckpointManager {
  // Oval track: start/finish line + one checkpoint.
  // Sequence: finish (start lap) -> checkpoint -> finish (complete lap).

  constructor(scene) {
    this.DEBUG_MESHES = false;

    this.scene = scene;
    this.checkpoints = [];
    this.finishLine = null;
    this.racers = [];
    this.chassisToRacer = new Map();
    this.playerRacer = null;
    this.totalLaps = 5;
    this.raceFinished = false;
    this.lapTimes = [];
    this.currentLapStartTime = 0;
    this.bestLapTime = Infinity;
    this.lapPathRecorder = null;

    this.lapCountElement = document.getElementById('lap-counter');
    this.currentLapTimeElement = document.getElementById('current-lap-time');
    this.bestLapTimeElement = document.getElementById('best-lap-time');

    this.updateTimerInterval = setInterval(() => this.updateCurrentLapTime(), 100);
  }

  init(car, { totalLaps = 5 } = {}) {
    this.totalLaps = totalLaps;
    this.raceFinished = false;
    this.registerRacer(car, { isPlayer: true, name: 'Player' });
    this.bestLapTime = Infinity;
    this.resetLapTimer();
    this.updatePlayerLapDisplay();
    if (this.bestLapTimeElement) {
      this.bestLapTimeElement.textContent = `Best: ${this.formatTime(this.bestLapTime)}`;
    }
  }

  registerRacer(vehicle, { isPlayer = false, name = 'Racer' } = {}) {
    const racer = {
      vehicle,
      isPlayer,
      name,
      checkpointProgress: 0,
      lapCount: 0,
      finished: false,
    };
    this.racers.push(racer);
    this.chassisToRacer.set(vehicle.chassis, racer);
    if (isPlayer) this.playerRacer = racer;
    return racer;
  }

  racerForChassis(chassis) {
    return this.chassisToRacer.get(chassis) ?? null;
  }

  getLapCount(vehicle) {
    const racer = this.chassisToRacer.get(vehicle.chassis);
    return racer ? racer.lapCount : 0;
  }

  getAllLapCounts() {
    return this.racers.map(r => ({ name: r.name, lapCount: r.lapCount, finished: r.finished }));
  }

  formatTime(timeMs) {
    if (timeMs === Infinity || timeMs === 0) {
      return '--:--.---';
    }

    const minutes = Math.floor(timeMs / 60000);
    const seconds = Math.floor((timeMs % 60000) / 1000);
    const milliseconds = Math.floor(timeMs % 1000);

    return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
  }

  updateCurrentLapTime() {
    if (!this.playerRacer || this.currentLapStartTime === 0 || this.playerRacer.checkpointProgress === 0) {
      return;
    }

    const lapTime = performance.now() - this.currentLapStartTime;
    if (this.currentLapTimeElement) {
      this.currentLapTimeElement.textContent = `Current: ${this.formatTime(lapTime)}`;
    }
  }

  resetLapTimer() {
    this.currentLapStartTime = 0;
    if (this.currentLapTimeElement) {
      this.currentLapTimeElement.textContent = 'Current: 0:00.000';
    }
  }

  startLapTimer() {
    this.currentLapStartTime = performance.now();
  }

  updatePlayerLapDisplay() {
    if (!this.lapCountElement || !this.playerRacer) return;
    const { lapCount, finished } = this.playerRacer;
    const current = finished
      ? this.totalLaps
      : Math.min(lapCount + 1, this.totalLaps);
    this.lapCountElement.textContent = `Lap ${current}/${this.totalLaps}`;
  }

  completePlayerLap() {
    if (this.currentLapStartTime === 0) return;

    const lastLapTime = performance.now() - this.currentLapStartTime;
    const isNewBest = lastLapTime < this.bestLapTime;
    if (isNewBest) {
      this.bestLapTime = lastLapTime;
      if (this.bestLapTimeElement) {
        this.bestLapTimeElement.textContent = `Best: ${this.formatTime(this.bestLapTime)}`;
      }
    }

    this.showLapCompletionMessage(isNewBest, lastLapTime);
    this.currentLapStartTime = performance.now();
  }

  onFinishLineCross(racer) {
    if (racer.finished) return;

    if (racer.checkpointProgress === 0) {
      racer.checkpointProgress = 1;
      if (racer.isPlayer) {
        this.startLapTimer();
        if (this.lapPathRecorder) this.lapPathRecorder.startLap();
      }
    } else if (racer.checkpointProgress === 2) {
      racer.lapCount++;
      racer.checkpointProgress = 1;

      if (racer.isPlayer) {
        this.completePlayerLap();
        this.updatePlayerLapDisplay();
        if (this.lapPathRecorder) this.lapPathRecorder.finishLap();

        if (racer.lapCount >= this.totalLaps) {
          this.finishRace(racer);
        }
      } else if (racer.lapCount >= this.totalLaps) {
        racer.finished = true;
      }
    }
  }

  onCheckpointCross(racer) {
    if (racer.finished) return;
    if (racer.checkpointProgress === 1) {
      racer.checkpointProgress = 2;
      if (racer.isPlayer) this.showCheckpointMessage();
    }
  }

  finishRace(racer) {
    racer.finished = true;
    this.raceFinished = true;
    this.updatePlayerLapDisplay();
    params.botDrive = false;
    this.showRaceFinishedMessage();
  }

  showRaceFinishedMessage() {
    let messageElement = document.getElementById('race-finished-message');
    if (!messageElement) {
      messageElement = document.createElement('div');
      messageElement.id = 'race-finished-message';
      messageElement.style.position = 'fixed';
      messageElement.style.top = '40%';
      messageElement.style.left = '50%';
      messageElement.style.transform = 'translate(-50%, -50%)';
      messageElement.style.color = '#4caf50';
      messageElement.style.fontFamily = "'Press Start 2P', monospace";
      messageElement.style.fontSize = 'clamp(16px, 3vw, 28px)';
      messageElement.style.fontWeight = 'bold';
      messageElement.style.textAlign = 'center';
      messageElement.style.background = 'rgba(0, 0, 0, 0.8)';
      messageElement.style.padding = '24px 32px';
      messageElement.style.borderRadius = '10px';
      messageElement.style.zIndex = '2000';
      document.body.appendChild(messageElement);
    }
    messageElement.textContent = 'RACE FINISHED!';
  }

  showLapCompletionMessage(isNewBest, lastLapTime) {
    let messageElement = document.getElementById('lap-completion-message');
    if (!messageElement) {
      messageElement = document.createElement('div');
      messageElement.id = 'lap-completion-message';
      messageElement.style.position = 'fixed';
      messageElement.style.top = '50%';
      messageElement.style.left = '50%';
      messageElement.style.transform = 'translate(-50%, -50%)';
      messageElement.style.color = 'white';
      messageElement.style.fontFamily = 'monospace';
      messageElement.style.fontSize = '28px';
      messageElement.style.fontWeight = 'bold';
      messageElement.style.textAlign = 'center';
      messageElement.style.background = 'rgba(0, 0, 0, 0.7)';
      messageElement.style.padding = '20px 30px';
      messageElement.style.borderRadius = '10px';
      messageElement.style.zIndex = '2000';
      messageElement.style.opacity = '0';
      messageElement.style.transition = 'opacity 0.5s ease';
      document.body.appendChild(messageElement);
    }

    if (isNewBest) {
      messageElement.innerHTML = `🏆 NEW BEST LAP! 🏆<br>${this.formatTime(lastLapTime)}`;
      messageElement.style.color = '#00ff00';
    } else {
      messageElement.innerHTML = `✅ LAP COMPLETE!<br>${this.formatTime(lastLapTime)}`;
      messageElement.style.color = 'white';
    }

    messageElement.style.opacity = '1';
    clearTimeout(this.messageTimeout);
    this.messageTimeout = setTimeout(() => {
      messageElement.style.opacity = '0';
    }, 3000);
  }

  showCheckpointMessage() {
    let messageElement = document.getElementById('checkpoint-message');
    if (!messageElement) {
      messageElement = document.createElement('div');
      messageElement.id = 'checkpoint-message';
      messageElement.style.position = 'fixed';
      messageElement.style.top = '60%';
      messageElement.style.left = '50%';
      messageElement.style.transform = 'translate(-50%, -50%)';
      messageElement.style.color = '#0088ff';
      messageElement.style.fontFamily = 'monospace';
      messageElement.style.fontSize = '24px';
      messageElement.style.fontWeight = 'bold';
      messageElement.style.textAlign = 'center';
      messageElement.style.background = 'rgba(0, 0, 0, 0.7)';
      messageElement.style.padding = '15px 25px';
      messageElement.style.borderRadius = '8px';
      messageElement.style.zIndex = '1900';
      messageElement.style.opacity = '0';
      messageElement.style.transition = 'opacity 0.5s ease';
      document.body.appendChild(messageElement);
    }

    messageElement.textContent = '🔵 CHECKPOINT PASSED!';
    messageElement.style.opacity = '1';
    clearTimeout(this.checkpointMessageTimeout);
    this.checkpointMessageTimeout = setTimeout(() => {
      messageElement.style.opacity = '0';
    }, 2000);
  }

  setupFinishLine(cube) {
    if (this.DEBUG_MESHES) {
      const geometry = new THREE.BoxGeometry(
        cube.scale.x * 2,
        cube.scale.y * 2,
        cube.scale.z * 2
      );
      const material = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.5
      });
      const visibleMesh = new THREE.Mesh(geometry, material);
      visibleMesh.position.copy(cube.position);
      visibleMesh.quaternion.copy(cube.quaternion);
      this.scene.scene.add(visibleMesh);
    }

    const ghostObject = new THREE.Object3D();
    ghostObject.position.copy(cube.position);
    ghostObject.quaternion.copy(cube.quaternion);
    this.scene.scene.add(ghostObject);

    this.scene.physics.add.existing(ghostObject, {
      shape: 'box',
      width: cube.scale.x * 2,
      height: cube.scale.y * 2,
      depth: cube.scale.z * 2,
      mass: 0,
      collisionFlags: 4
    });

    const self = this;
    ghostObject.body.on.collision((otherObject, event) => {
      if (event !== 'start') return;
      const racer = self.racerForChassis(otherObject);
      if (racer) self.onFinishLineCross(racer);
    });

    this.finishLine = { ghost: ghostObject };
  }

  setupCheckpoint(cube, checkpointIndex = 1) {
    if (this.DEBUG_MESHES) {
      const geometry = new THREE.BoxGeometry(
        cube.scale.x * 2,
        cube.scale.y * 2,
        cube.scale.z * 2
      );
      const material = new THREE.MeshBasicMaterial({
        color: 0x0000ff,
        transparent: true,
        opacity: 0.5
      });
      const visibleMesh = new THREE.Mesh(geometry, material);
      visibleMesh.position.copy(cube.position);
      visibleMesh.quaternion.copy(cube.quaternion);
      this.scene.scene.add(visibleMesh);
    }

    const ghostObject = new THREE.Object3D();
    ghostObject.position.copy(cube.position);
    ghostObject.quaternion.copy(cube.quaternion);
    this.scene.scene.add(ghostObject);

    this.scene.physics.add.existing(ghostObject, {
      shape: 'box',
      width: cube.scale.x * 2,
      height: cube.scale.y * 2,
      depth: cube.scale.z * 2,
      mass: 0,
      collisionFlags: 4
    });

    const self = this;
    ghostObject.body.on.collision((otherObject, event) => {
      if (event !== 'start') return;
      const racer = self.racerForChassis(otherObject);
      if (racer) self.onCheckpointCross(racer);
    });

    this.checkpoints.push({
      index: checkpointIndex,
      ghost: ghostObject,
    });
  }

  reset() {
    for (const racer of this.racers) {
      racer.checkpointProgress = 0;
      racer.lapCount = 0;
      racer.finished = false;
    }
    this.raceFinished = false;
    this.resetLapTimer();
    this.bestLapTime = Infinity;
    this.updatePlayerLapDisplay();
    if (this.bestLapTimeElement) {
      this.bestLapTimeElement.textContent = 'Best: --:--.---';
    }
  }

  cleanup() {
    if (this.updateTimerInterval) {
      clearInterval(this.updateTimerInterval);
    }
    clearTimeout(this.messageTimeout);
    clearTimeout(this.checkpointMessageTimeout);

    for (const id of ['lap-completion-message', 'checkpoint-message', 'race-finished-message']) {
      const element = document.getElementById(id);
      element?.remove();
    }
  }
}

export { CheckpointManager };
