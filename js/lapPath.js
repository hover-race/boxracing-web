// Records the car's {x, y, z} position every frame for one lap, then on lap
// completion computes cumulative distance, normalizes it to u = dist / lapLength,
// and downloads the racing line as lap-N.json (array of {u, x, y, z}).
class LapPathRecorder {
  constructor() {
    this.recording = false;
    this.points = [];
    this.lapNumber = 0;
  }

  startLap() {
    this.points = [];
    this.recording = true;
  }

  recordFrame(position) {
    if (!this.recording || !params.recordLaps) return;
    this.points.push({ x: position.x, y: position.y, z: position.z });
  }

  finishLap() {
    if (this.recording && params.recordLaps && this.points.length >= 2) {
      this.lapNumber++;
      const normalized = this.normalize(this.points);
      this.download(normalized, `lap-${this.lapNumber}.json`);
    }
    this.startLap();
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
