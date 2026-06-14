// Records the car's {x, y, z} every frame into memory. Lap boundaries and
// normalized racing lines are stored on finish-line cross. Export manually via
// window.downloadTrackTrace() or window.downloadLap(n).
class LapPathRecorder {
  constructor() {
    this.recording = false;
    this.points = [];
    this.lapStarts = [0];
    this.laps = [];
    this.lapNumber = 0;
  }

  startSession() {
    this.points = [];
    this.lapStarts = [0];
    this.laps = [];
    this.lapNumber = 0;
    this.recording = true;
    window.__trackTrace = this;
  }

  startLap() {
    if (!params.recordLaps) return;
    if (this.points.length > 0 && this.lapStarts[this.lapStarts.length - 1] !== this.points.length) {
      this.lapStarts.push(this.points.length);
    }
    this.recording = true;
  }

  recordFrame(position) {
    if (!this.recording || !params.recordLaps) return;
    this.points.push({ x: position.x, y: position.y, z: position.z });
  }

  finishLap() {
    if (!params.recordLaps || this.points.length < 2) return;
    const start = this.lapStarts[this.lapStarts.length - 1];
    const lapPoints = this.points.slice(start);
    if (lapPoints.length < 2) return;
    this.lapNumber++;
    this.laps.push({
      lapNumber: this.lapNumber,
      start,
      end: this.points.length,
      normalized: this.normalize(lapPoints),
    });
  }

  downloadTrace(filename = 'track-trace.json') {
    this.download({
      lapCount: this.lapNumber,
      lapStarts: this.lapStarts,
      points: this.points.map((p) => ({
        x: Number(p.x.toFixed(3)),
        y: Number(p.y.toFixed(3)),
        z: Number(p.z.toFixed(3)),
      })),
    }, filename);
  }

  downloadLap(n, filename = null) {
    const lap = this.laps[n - 1];
    if (!lap) return;
    this.download(lap.normalized, filename || `lap-${n}.json`);
  }

  normalize(points) {
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      const dz = points[i].z - points[i - 1].z;
      cumulative[i] = cumulative[i - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const lapLength = cumulative[cumulative.length - 1];
    return points.map((p, i) => ({
      u: Number((lapLength > 0 ? cumulative[i] / lapLength : 0).toFixed(5)),
      x: Number(p.x.toFixed(3)),
      y: Number(p.y.toFixed(3)),
      z: Number(p.z.toFixed(3))
    }));
  }

  download(data, filename) {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export { LapPathRecorder };
