// Player autosteer: align heading with centerline tangent. Lateral is measured only
// for GUI / too-far cutout (botMaxOffset), not for steering.
const HOLD_SEC = 0.5;
const BLEND_SEC = 0.5;

class AutoSteer {
  constructor(lines) {
    this.laps = lines.map((line) => ({ line, u: 0 }));
    this.steering = 0;
    this.assist = 0;
    this.prevInputMag = 0;
    this.holdRemaining = 0;
    this.blendElapsed = 0;
    this.needsBlendIn = false;
    this._fwd = new THREE.Vector3();
    this.latLog = [];
    this._logT0 = performance.now();
  }

  resetLatLog() {
    this.latLog = [];
    this._logT0 = performance.now();
  }

  recordFrame(car, lap, extras = {}) {
    const speedKmh = Math.abs(car.vehicle.getCurrentSpeedKmHour());
    const headingErr = extras.headingErr;
    this.latLog.push({
      t: (performance.now() - this._logT0) / 1000,
      lateral: lap.lateral,
      err: lap.err,
      u: lap.u,
      speedKmh,
      steer: this.steering,
      wheelSteer: extras.wheelSteer ?? null,
      headingErr,
      headingDeg: headingErr != null ? headingErr * 180 / Math.PI : null,
      target: extras.target ?? null,
      assist: this.assist,
    });
    if (this.latLog.length > 12000) this.latLog.shift();
    window.__latLog = this.latLog;
  }

  _logFrame(car, lap, extras = {}) {
    this.recordFrame(car, lap, extras);
  }

  static summarizeLatLog(log) {
    if (!log.length) return { frames: 0, buckets: [] };
    const buckets = [
      { label: '0-30 km/h', min: 0, max: 30, n: 0, latSum: 0, latSq: 0, absMax: 0 },
      { label: '30-60 km/h', min: 30, max: 60, n: 0, latSum: 0, latSq: 0, absMax: 0 },
      { label: '60-90 km/h', min: 60, max: 90, n: 0, latSum: 0, latSq: 0, absMax: 0 },
      { label: '90+ km/h', min: 90, max: Infinity, n: 0, latSum: 0, latSq: 0, absMax: 0 },
    ];
    for (const row of log) {
      const b = buckets.find((x) => row.speedKmh >= x.min && row.speedKmh < x.max);
      if (!b) continue;
      b.n++;
      b.latSum += row.lateral;
      b.latSq += row.lateral * row.lateral;
      b.absMax = Math.max(b.absMax, Math.abs(row.lateral));
    }
    return {
      frames: log.length,
      durationSec: log[log.length - 1].t,
      buckets: buckets.filter((b) => b.n > 0).map((b) => ({
        speed: b.label,
        n: b.n,
        latMean: b.latSum / b.n,
        latRms: Math.sqrt(b.latSq / b.n),
        latAbsMax: b.absMax,
      })),
    };
  }

  drive(car, manualSteering, deltaTime) {
    if (params.autoSteer) {
      return this.steeringFor(car, manualSteering, deltaTime);
    }
    const lap = this.measureLateral(car);
    this._logFrame(car, lap);
    vehicleParams.autoSteerAssist = 0;
    return manualSteering;
  }

  patchWheelLog(wheelSteer) {
    if (!this.latLog.length) return;
    this.latLog[this.latLog.length - 1].wheelSteer = wheelSteer;
  }

  dumpLog() {
    if (!this.latLog.length) return;
    const summary = AutoSteer.summarizeLatLog(this.latLog);
    window.__latLogSummary = summary;
    window.dumpLatLog = () => this.dumpLog();
    console.log('__latLogSummary', summary);
    console.table(summary.buckets);
  }

  _setAssist(amount) {
    this.assist = amount;
    vehicleParams.autoSteerAssist = amount;
  }

  // Tangent/normal at u from three curve samples spaced `spacingM` apart (chord prev→next).
  tangentFrame(line, u, spacingM) {
    const du = spacingM / line.length;
    const prev = line.sample(u - du);
    const here = line.sample(u);
    const next = line.sample(u + du);
    const tangentX = next.x - prev.x;
    const tangentZ = next.z - prev.z;
    const tLen = Math.hypot(tangentX, tangentZ) || 1;
    return {
      here,
      tangentX,
      tangentZ,
      nx: -tangentZ / tLen,
      nz: tangentX / tLen,
    };
  }

  signedLateralAt(line, u, x, z, distM) {
    const { here, nx, nz } = this.tangentFrame(line, u, distM);
    return (x - here.x) * nx + (z - here.z) * nz;
  }

  headingErrRad(car, line, u, spacingM, lookaheadM) {
    const uRef = u + lookaheadM / line.length;
    const fwd = this._fwd.set(0, 0, 1).applyQuaternion(car.chassis.quaternion);
    const { tangentX, tangentZ } = this.tangentFrame(line, uRef, spacingM);
    return Math.atan2(
      fwd.z * tangentX - fwd.x * tangentZ,
      fwd.x * tangentX + fwd.z * tangentZ
    );
  }

  seedAtCar(car) {
    const pos = car.chassis.position;
    for (const lap of this.laps) {
      lap.u = lap.line.project(pos.x, pos.z, null);
      const here = lap.line.sample(lap.u);
      lap.err = Math.hypot(pos.x - here.x, pos.z - here.z);
      lap.lateral = this.signedLateralAt(lap.line, lap.u, pos.x, pos.z, params.botCurvatureSpacing);
    }
  }

  measureLateral(car, dt = 1 / 60) {
    const pos = car.chassis.position;
    const speedMps = Math.abs(car.vehicle.getCurrentSpeedKmHour()) / 3.6;
    let best = null;
    for (const lap of this.laps) {
      const hint = lap.u + speedMps * dt / lap.line.length;
      lap.u = lap.line.project(pos.x, pos.z, hint);
      let here = lap.line.sample(lap.u);
      lap.err = Math.hypot(pos.x - here.x, pos.z - here.z);
      if (lap.err > 8) {
        const globalU = lap.line.project(pos.x, pos.z, null);
        const globalHere = lap.line.sample(globalU);
        const globalErr = Math.hypot(pos.x - globalHere.x, pos.z - globalHere.z);
        let du = globalU - lap.u;
        if (du > 0.5) du -= 1;
        else if (du < -0.5) du += 1;
        if (globalErr + 1 < lap.err || Math.abs(du) > 0.2) {
          lap.u = globalU;
          here = globalHere;
          lap.err = globalErr;
        }
      }
      lap.lateral = this.signedLateralAt(lap.line, lap.u, pos.x, pos.z, params.botCurvatureSpacing);
      if (!best || lap.err < best.err) best = lap;
    }
    const lookaheadM = params.botLookahead + speedMps * params.botLookaheadTime;
    const headingErrRad = this.headingErrRad(
      car, best.line, best.u, params.botCurvatureSpacing, lookaheadM
    );
    vehicleParams.autoSteerLateral = best.lateral;
    vehicleParams.autoSteerHeadingDeg = headingErrRad * 180 / Math.PI;
    return best;
  }

  steeringFor(car, manualSteering = 0, deltaTime = 0) {
    const dt = deltaTime > 0 ? deltaTime / 1000 : 1 / 60;
    const best = this.measureLateral(car, dt);
    const inputMag = Math.abs(manualSteering);
    const headingErrRad = vehicleParams.autoSteerHeadingDeg * Math.PI / 180;

    if (best.err > params.botMaxOffset) {
      this.holdRemaining = 0;
      this.blendElapsed = 0;
      this.needsBlendIn = false;
      this._setAssist(0);
      this.prevInputMag = inputMag;
      this._logFrame(car, best);
      if (inputMag > 0) return Math.max(-1, Math.min(1, manualSteering));
      return 0;
    }

    let target = -params.botSteerGain * params.autoSteerStrength * headingErrRad;
    target = Math.max(-params.botMaxSteer, Math.min(params.botMaxSteer, target));

    const logExtras = { headingErr: headingErrRad, target };

    const delta = target - this.steering;
    if (Math.abs(delta) > params.botSteerRate) {
      target = this.steering + Math.sign(delta) * params.botSteerRate;
    }
    this.steering = target;

    if (inputMag > 0) {
      this.holdRemaining = 0;
      this.blendElapsed = 0;
      this.needsBlendIn = false;
      this._setAssist(1 - inputMag);
      this.prevInputMag = inputMag;
      this._logFrame(car, best, logExtras);
      return Math.max(-1, Math.min(1, this.steering * this.assist + manualSteering * inputMag));
    }

    if (this.prevInputMag > 0) {
      this.holdRemaining = HOLD_SEC;
      this.blendElapsed = 0;
      this.needsBlendIn = true;
    }
    this.prevInputMag = 0;

    if (this.holdRemaining > 0) {
      this.holdRemaining = Math.max(0, this.holdRemaining - dt);
      this._setAssist(0);
      this._logFrame(car, best, logExtras);
      return 0;
    }

    if (this.needsBlendIn && BLEND_SEC > 0) {
      this.blendElapsed = Math.min(BLEND_SEC, this.blendElapsed + dt);
      this._setAssist(this.blendElapsed / BLEND_SEC);
      if (this.blendElapsed >= BLEND_SEC) this.needsBlendIn = false;
      this._logFrame(car, best, logExtras);
      return Math.max(-1, Math.min(1, this.steering * this.assist));
    }

    this.needsBlendIn = false;
    this._setAssist(1);
    this._logFrame(car, best, logExtras);
    return Math.max(-1, Math.min(1, this.steering));
  }
}

export { AutoSteer };
