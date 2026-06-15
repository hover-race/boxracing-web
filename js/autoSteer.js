// Player autosteer: project onto the smoothed centerline, then steer to hold
// zero lateral offset. Tuning lives here — GUI only exposes on/off and strength.
const HOLD_SEC = 0.5;
const BLEND_SEC = 0.5;
const LOOKAHEAD = 6;
const LOOKAHEAD_TIME = 0.15;
const STANLEY_K = 1.0;
const STANLEY_SOFT = 5;
const VEL_GAIN = 1.6;
const HEADING_GAIN = 0.06;
const STEER_RATE = 0.025;
const STEER_RATE_REVERSE = 0.12;
const STEER_SMOOTH = 0.5;
const STEER_SMOOTH_REVERSE = 0.12;
const LAT_FILTER = 0.2;
const LAT_DEADBAND = 0.05;
const STRAIGHT_CURV = 0.004;

class AutoSteer {
  constructor(lines) {
    this.laps = lines.map((line) => ({ line, u: 0 }));
    this.steering = 0;
    this.filtLat = 0;
    this.filtCrossVel = 0;
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
      crossVel: extras.crossVel ?? null,
      curveBlend: extras.curveBlend ?? null,
      latSteer: extras.latSteer ?? null,
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

  lookaheadM(speedMps) {
    return LOOKAHEAD + speedMps * LOOKAHEAD_TIME;
  }

  tangentFrame(line, u, distM) {
    const here = line.sample(u);
    const ahead = line.sample(u + distM / line.length);
    const tangentX = ahead.x - here.x;
    const tangentZ = ahead.z - here.z;
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

  seedAtCar(car) {
    const pos = car.chassis.position;
    for (const lap of this.laps) {
      lap.u = lap.line.project(pos.x, pos.z, null);
      const here = lap.line.sample(lap.u);
      lap.err = Math.hypot(pos.x - here.x, pos.z - here.z);
      lap.lateral = this.signedLateralAt(lap.line, lap.u, pos.x, pos.z, LOOKAHEAD);
      this.filtLat = lap.lateral;
      this.filtCrossVel = 0;
    }
  }

  curvatureAt(line, u, spacing = 8) {
    const du = spacing / line.length;
    const a = line.sample(u - du);
    const b = line.sample(u);
    const c = line.sample(u + du);
    const dAB = Math.hypot(b.x - a.x, b.z - a.z);
    const dBC = Math.hypot(c.x - b.x, c.z - b.z);
    const dAC = Math.hypot(c.x - a.x, c.z - a.z);
    if (dAB * dBC * dAC < 1e-6) return 0;
    const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    return (2 * area2) / (dAB * dBC * dAC);
  }

  measureLateral(car, dt = 1 / 60) {
    const pos = car.chassis.position;
    const speedMps = Math.abs(car.vehicle.getCurrentSpeedKmHour()) / 3.6;
    const tangentM = this.lookaheadM(speedMps);
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
      lap.lateral = this.signedLateralAt(lap.line, lap.u, pos.x, pos.z, tangentM);
      if (!best || lap.err < best.err) best = lap;
    }
    vehicleParams.autoSteerLateral = best.lateral;
    return best;
  }

  steeringFor(car, manualSteering = 0, deltaTime = 0) {
    const dt = deltaTime > 0 ? deltaTime / 1000 : 1 / 60;
    const pos = car.chassis.position;
    const fwd = this._fwd.set(0, 0, 1).applyQuaternion(car.chassis.quaternion);
    const best = this.measureLateral(car, dt);

    const inputMag = Math.abs(manualSteering);
    const strength = params.autoSteerStrength;

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

    const latSmooth = 1 - Math.exp(-dt / LAT_FILTER);
    this.filtLat += latSmooth * (best.lateral - this.filtLat);

    const curv = this.curvatureAt(best.line, best.u);
    const curveBlend = Math.min(1, curv / STRAIGHT_CURV);
    const straightBlend = Math.max(0, Math.min(1, 1 - curveBlend / 0.35));
    const deadband = LAT_DEADBAND + straightBlend * (0.12 - LAT_DEADBAND);
    let lateralErr = this.filtLat;
    if (Math.abs(lateralErr) < deadband) lateralErr = 0;
    else lateralErr -= Math.sign(lateralErr) * deadband;

    const speedMps = Math.abs(car.vehicle.getCurrentSpeedKmHour()) / 3.6;
    const tangentM = this.lookaheadM(speedMps);
    const { tangentX, tangentZ, nx, nz } = this.tangentFrame(best.line, best.u, tangentM);
    const headingErr = Math.atan2(
      fwd.z * tangentX - fwd.x * tangentZ,
      fwd.x * tangentX + fwd.z * tangentZ
    );

    const vel = car.chassis.body.ammo.getLinearVelocity();
    const crossVel = vel.x() * nx + vel.z() * nz;
    const crossSmooth = 1 - Math.exp(-dt / 0.15);
    this.filtCrossVel += crossSmooth * (crossVel - this.filtCrossVel);

    const lineBlend = Math.min(1, Math.abs(lateralErr));
    const soft = STANLEY_SOFT + speedMps * (0.3 - 0.2 * lineBlend) + straightBlend * speedMps * 0.2;
    const latSteer = Math.atan(STANLEY_K * (1 - 0.3 * straightBlend) * lateralErr / (speedMps + soft));
    const headWeight = 1 - 0.5 * straightBlend;
    const headGain = HEADING_GAIN * (1 - 0.6 * straightBlend);
    const speedDamp = 1 / (1 + (speedMps / 25) ** 2);
    const crossDamp = speedDamp + (0.35 - speedDamp) * lineBlend;
    const crossScale = 1 - 0.75 * straightBlend;
    const velGain = VEL_GAIN * (1 - 0.25 * straightBlend) * crossDamp * crossScale;
    let target = strength * (
      -latSteer
      - headGain * headingErr * headWeight
    ) - velGain * this.filtCrossVel;
    target = Math.max(-params.botMaxSteer, Math.min(params.botMaxSteer, target));

    const logExtras = { headingErr, crossVel: this.filtCrossVel, curveBlend, latSteer, target };

    const reversing = target * this.steering < 0 && Math.abs(target) > 0.06 + straightBlend * 0.06;
    const steerRate = reversing ? STEER_RATE_REVERSE : STEER_RATE;
    const delta = target - this.steering;
    if (Math.abs(delta) > steerRate) {
      target = this.steering + Math.sign(delta) * steerRate;
    }
    const smoothTau = (reversing ? STEER_SMOOTH_REVERSE : STEER_SMOOTH)
      * (1 + (1 - lineBlend) * speedMps / 30)
      * (1 + straightBlend * speedMps / 35);
    const outSmooth = 1 - Math.exp(-dt / smoothTau);
    this.steering += outSmooth * (target - this.steering);

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
