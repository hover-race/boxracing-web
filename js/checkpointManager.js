import { on, off } from './raceEvents.js';

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
    this.raceStartTime = 0;
    this.lapTimes = [];
    this.currentLapStartTime = 0;
    this.bestLapTime = Infinity;
    this.lapPathRecorder = null;
    this.trackLine = null;
    this.startU = 0;
    this.splitFracs = [0, 0.25, 0.5, 0.75];

    this.lapCountElement = document.getElementById('lap-counter');
    this.lapTimeWholeElement = document.getElementById('lap-time-whole');
    this.lapTimeFracElement = document.getElementById('lap-time-frac');
    this.bestLapTimeElement = document.getElementById('best-lap-time');
    this.positionElement = document.getElementById('race-hud-position');
    this.playerNameElement = document.getElementById('race-hud-player-name');
    this.standingsElement = document.getElementById('race-hud-standings');
    this.finishElement = document.getElementById('race-finish');
    this.finishTitleElement = document.getElementById('race-finish-title');
    this.finishStandingsElement = document.getElementById('race-finish-standings');

    this.onRaceStart = () => {
      this.raceStartTime = performance.now();
    };
    on('raceStart', this.onRaceStart);

    this.updateTimerInterval = setInterval(() => this.updateRaceHud(), 100);
  }

  init(car, { totalLaps = 5, trackLine = null } = {}) {
    this.totalLaps = totalLaps;
    this.raceFinished = false;
    this.trackLine = trackLine;
    if (trackLine && this.finishLine?.ghost) {
      const p = this.finishLine.ghost.position;
      this.startU = trackLine.project(p.x, p.z);
    } else {
      this.startU = 0;
    }
    this.initTimingSplits();
    this.registerRacer(car, { isPlayer: true, name: params.playerName || 'Player' });
    this.bestLapTime = Infinity;
    this.resetLapTimer();
    this.updatePlayerLapDisplay();
    this.updateStandings();
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
      finishTime: 0,
      trackU: null,
      gridFrac: null,
      lastFrac: null,
      splitIndex: 0,
      splitTimes: [],
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
    if (timeMs === Infinity) {
      return '-:--.-';
    }

    const minutes = Math.floor(timeMs / 60000);
    const seconds = Math.floor((timeMs % 60000) / 1000);
    const tenths = Math.floor(timeMs / 100) % 10;
    return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`;
  }

  setLapTimeDisplay(timeMs) {
    const text = this.formatTime(timeMs);
    const dot = text.lastIndexOf('.');
    if (this.lapTimeWholeElement) this.lapTimeWholeElement.textContent = text.slice(0, dot);
    if (this.lapTimeFracElement) this.lapTimeFracElement.textContent = text.slice(dot + 1);
  }

  updateRaceHud() {
    this.updateCurrentLapTime();
    this.pollSplits();
    this.updateStandings();
  }

  initTimingSplits() {
    let cp = 0.5;
    if (this.trackLine && this.checkpoints[0]?.ghost) {
      const p = this.checkpoints[0].ghost.position;
      const u = this.trackLine.project(p.x, p.z);
      cp = u - this.startU;
      if (cp < 0) cp += 1;
      if (cp < 0.08 || cp > 0.92) cp = 0.5;
    }
    this.splitFracs = [0, cp * 0.5, cp, cp + (1 - cp) * 0.5];
  }

  signedFrac(u) {
    let frac = u - this.startU;
    if (frac > 0.5) frac -= 1;
    if (frac < -0.5) frac += 1;
    return frac;
  }

  fracFromStart(u) {
    let frac = u - this.startU;
    if (frac < 0) frac += 1;
    return frac;
  }

  forwardDelta(prev, curr) {
    let d = curr - prev;
    if (d < -0.5) d += 1;
    if (d > 0.5) d -= 1;
    return d;
  }

  crossedGate(prev, curr, gate) {
    if (prev <= curr) return prev < gate && gate <= curr;
    return prev < gate || gate <= curr;
  }

  sampleOnTrack(racer) {
    if (!this.trackLine) return null;
    const pos = racer.vehicle.visualRoot.position;
    const maxDist = 22;
    let u = this.trackLine.project(pos.x, pos.z, racer.trackU);
    let p = this.trackLine.sample(u);
    let dist = Math.hypot(pos.x - p.x, pos.z - p.z);
    if (dist > maxDist) {
      u = this.trackLine.project(pos.x, pos.z, null);
      p = this.trackLine.sample(u);
      dist = Math.hypot(pos.x - p.x, pos.z - p.z);
    }
    if (dist > maxDist) return null;
    return u;
  }

  pollSplits() {
    const now = performance.now();
    const n = this.splitFracs.length;
    const maxStep = 0.1;
    for (const racer of this.racers) {
      if (racer.finished) continue;
      const u = this.sampleOnTrack(racer);
      if (u == null) continue;

      const frac = this.fracFromStart(u);
      racer.trackU = u;
      if (racer.gridFrac == null) racer.gridFrac = this.signedFrac(u);

      if (racer.checkpointProgress === 0 || racer.lastFrac == null) {
        racer.lastFrac = frac;
        continue;
      }

      const d = this.forwardDelta(racer.lastFrac, frac);
      if (d > 0 && d <= maxStep) {
        const next = this.splitFracs[racer.splitIndex % n];
        if (this.crossedGate(racer.lastFrac, frac, next)) {
          racer.splitTimes[racer.splitIndex] = now;
          racer.splitIndex++;
        }
      }
      racer.lastFrac = frac;
    }
  }

  syncSplitsToLap(racer) {
    const minSplits = racer.lapCount * this.splitFracs.length;
    const now = performance.now();
    while (racer.splitIndex < minSplits) {
      racer.splitTimes[racer.splitIndex] = now;
      racer.splitIndex++;
    }
  }

  rankedRacers() {
    const finished = [];
    const racing = [];
    for (const racer of this.racers) {
      if (racer.finished) finished.push(racer);
      else racing.push(racer);
    }
    finished.sort((a, b) => a.finishTime - b.finishTime);
    racing.sort((a, b) => {
      if (b.lapCount !== a.lapCount) return b.lapCount - a.lapCount;
      if (b.splitIndex !== a.splitIndex) return b.splitIndex - a.splitIndex;
      if (a.splitIndex === 0) return (b.gridFrac ?? 0) - (a.gridFrac ?? 0);
      return a.splitTimes[a.splitIndex - 1] - b.splitTimes[b.splitIndex - 1];
    });
    return finished.concat(racing);
  }

  formatGap(ms) {
    const s = ms / 1000;
    if (s < 60) return `+${s.toFixed(1)}`;
    const m = Math.floor(s / 60);
    const rem = s - m * 60;
    return `+${m}:${rem.toFixed(1).padStart(4, '0')}`;
  }

  gapBehind(racer, leader) {
    if (racer === leader) return '—';
    const leaderProg = leader.lapCount + (leader.trackU != null ? this.fracFromStart(leader.trackU) : 0);
    const racerProg = racer.lapCount + (racer.trackU != null ? this.fracFromStart(racer.trackU) : 0);
    const laps = Math.floor(leaderProg - racerProg);
    if (laps >= 1) return laps === 1 ? '+1 LAP' : `+${laps} LAPS`;
    const k = racer.splitIndex - 1;
    if (k < 0) return '—';
    const leaderT = leader.splitTimes[k];
    const racerT = racer.splitTimes[k];
    if (leaderT == null || racerT == null) return '—';
    const ms = racerT - leaderT;
    if (ms < 0) return '—';
    return this.formatGap(ms);
  }

  resetLapProgress(vehicle) {
    const racer = this.chassisToRacer.get(vehicle.chassis);
    if (!racer || racer.finished) return;
    if (racer.checkpointProgress > 0) racer.checkpointProgress = 1;
    const keep = racer.lapCount * this.splitFracs.length;
    racer.splitTimes.length = keep;
    racer.splitIndex = keep;
    racer.trackU = null;
    racer.lastFrac = null;
    if (racer.isPlayer && racer.checkpointProgress > 0) this.startLapTimer();
    this.updateStandings();
  }

  syncStandingsRows(count) {
    const list = this.standingsElement;
    if (!list) return;
    while (list.children.length < count) {
      const row = document.createElement('div');
      row.className = 'race-hud-racer';
      row.innerHTML =
        '<span class="race-hud-racer-pos"></span>' +
        '<span class="race-hud-racer-name"></span>' +
        '<span class="race-hud-racer-gap"></span>';
      list.appendChild(row);
    }
    while (list.children.length > count) list.lastChild.remove();
  }

  updateStandings() {
    if (!this.playerRacer || this.racers.length === 0) return;
    const ranked = this.rankedRacers();
    const leader = ranked[0];
    const place = ranked.indexOf(this.playerRacer) + 1;
    if (this.positionElement) {
      this.positionElement.textContent = `P${place}`;
    }
    if (this.playerNameElement) {
      this.playerNameElement.textContent = this.playerRacer.name;
    }

    this.syncStandingsRows(ranked.length);
    if (!this.standingsElement) return;
    for (let i = 0; i < ranked.length; i++) {
      const racer = ranked[i];
      const row = this.standingsElement.children[i];
      row.classList.toggle('is-player', racer.isPlayer);
      row.children[0].textContent = `P${i + 1}`;
      row.children[1].textContent = racer.name;
      row.children[2].textContent = this.gapBehind(racer, leader);
    }
  }

  updateCurrentLapTime() {
    if (!this.playerRacer || this.currentLapStartTime === 0 || this.playerRacer.checkpointProgress === 0) {
      return;
    }
    this.setLapTimeDisplay(performance.now() - this.currentLapStartTime);
  }

  resetLapTimer() {
    this.currentLapStartTime = 0;
    this.setLapTimeDisplay(0);
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
    this.lapCountElement.textContent = `${current}/${this.totalLaps}`;
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
      this.syncSplitsToLap(racer);

      if (racer.isPlayer) {
        this.completePlayerLap();
        this.updatePlayerLapDisplay();
        if (this.lapPathRecorder) this.lapPathRecorder.finishLap();

        if (racer.lapCount >= this.totalLaps) {
          this.finishRace(racer);
        }
      } else if (racer.lapCount >= this.totalLaps) {
        racer.finished = true;
        racer.finishTime = performance.now();
        if (this.raceFinished) this.updateRaceFinishStandings();
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
    racer.finishTime = performance.now();
    this.raceFinished = true;
    this.updatePlayerLapDisplay();
    this.scene.cameraSwitcher.setController(1);
    this.showRaceFinishedMessage();
    this.scene.replay?.onPlayerFinished();
  }

  showRaceFinishedMessage() {
    const ranked = this.rankedRacers();
    const place = ranked.indexOf(this.playerRacer) + 1;
    const mod100 = place % 100;
    const suffix = mod100 >= 11 && mod100 <= 13
      ? 'th'
      : ['th', 'st', 'nd', 'rd'][Math.min(place % 10, 4)] || 'th';

    this.finishTitleElement.textContent = `YOU FINISHED ${place}${suffix}!`;
    this.updateRaceFinishStandings();
    this.finishElement.classList.add('visible');
  }

  updateRaceFinishStandings() {
    const ranked = this.rankedRacers();
    const winner = ranked[0];
    this.finishStandingsElement.replaceChildren();

    for (let i = 0; i < ranked.length; i++) {
      const racer = ranked[i];
      const row = document.createElement('div');
      row.className = `race-finish-racer${racer.isPlayer ? ' is-player' : ''}`;

      const position = document.createElement('span');
      position.textContent = `P${i + 1}`;

      const name = document.createElement('span');
      name.className = 'race-finish-racer-name';
      name.textContent = racer.name;

      const time = document.createElement('span');
      time.className = 'race-finish-racer-time';
      if (!racer.finished) {
        time.textContent = '—';
      } else if (i === 0) {
        time.textContent = this.formatTime(racer.finishTime - this.raceStartTime);
      } else {
        time.textContent = this.formatGap(racer.finishTime - winner.finishTime);
      }

      row.append(position, name, time);
      this.finishStandingsElement.appendChild(row);
    }
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
      racer.finishTime = 0;
      racer.trackU = null;
      racer.gridFrac = null;
      racer.lastFrac = null;
      racer.splitIndex = 0;
      racer.splitTimes = [];
    }
    this.raceFinished = false;
    this.raceStartTime = 0;
    this.finishElement?.classList.remove('visible');
    this.resetLapTimer();
    this.bestLapTime = Infinity;
    this.updatePlayerLapDisplay();
    this.updateStandings();
    if (this.bestLapTimeElement) {
      this.bestLapTimeElement.textContent = 'Best: --:--.---';
    }
  }

  cleanup() {
    if (this.updateTimerInterval) {
      clearInterval(this.updateTimerInterval);
    }
    off('raceStart', this.onRaceStart);
    clearTimeout(this.messageTimeout);
    clearTimeout(this.checkpointMessageTimeout);

    this.finishElement?.classList.remove('visible');

    for (const id of ['lap-completion-message', 'checkpoint-message']) {
      const element = document.getElementById(id);
      element?.remove();
    }
  }
}

export { CheckpointManager };
