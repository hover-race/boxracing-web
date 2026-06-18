const fs = require('fs');
const path = require('path');

const glbPath = path.join(__dirname, '../assets/glb/rcc-oval.glb');
const outPath = path.join(__dirname, '../laps/track-centerline.json');

const buf = fs.readFileSync(glbPath);
const jsonLen = buf.readUInt32LE(12);
const pad = (4 - (jsonLen % 4)) % 4;
const binOffset = 20 + jsonLen + 8 + pad;
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));

function readVec3(accIndex) {
  const acc = json.accessors[accIndex];
  const bv = json.bufferViews[acc.bufferView];
  const off = binOffset + (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const out = [];
  for (let i = 0; i < acc.count; i++) {
    const o = off + i * 12;
    out.push([buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)]);
  }
  return out;
}

const node = json.nodes.find((n) => n.name === '1TARMAC_oval');
const s = 0.02539999969303608;
const tz = -28.000015258789062;
const verts = readVec3(json.meshes[node.mesh].primitives[0].attributes.POSITION);
const points = verts.map(([x, y, z]) => ({ x: x * s, y: y * s, z: z * s + tz }));

function polarCenterline(pts, bins = 720, minPerBin = 6) {
  let cx = 0;
  let cz = 0;
  for (const p of pts) { cx += p.x; cz += p.z; }
  cx /= pts.length;
  cz /= pts.length;

  const buckets = Array.from({ length: bins }, () => ({ rs: [], ys: [] }));
  for (const p of pts) {
    const dx = p.x - cx;
    const dz = p.z - cz;
    const r = Math.hypot(dx, dz);
    if (r < 5) continue;
    let a = Math.atan2(dz, dx);
    if (a < 0) a += Math.PI * 2;
    const bin = Math.min(bins - 1, Math.floor((a / (Math.PI * 2)) * bins));
    buckets[bin].rs.push(r);
    buckets[bin].ys.push(p.y);
  }

  const active = [];
  for (let i = 0; i < bins; i++) {
    const rs = buckets[i].rs.sort((a, b) => a - b);
    if (rs.length < minPerBin) continue;
    const rMid = (rs[Math.floor(rs.length * 0.1)] + rs[Math.floor(rs.length * 0.9)]) * 0.5;
    const ang = (i + 0.5) / bins * Math.PI * 2;
    const y = buckets[i].ys.reduce((a, b) => a + b, 0) / buckets[i].ys.length;
    active.push({ bin: i, x: cx + Math.cos(ang) * rMid, y, z: cz + Math.sin(ang) * rMid });
  }
  return active;
}

function splitActiveSegments(active, maxGap = 10, minSegLen = 5) {
  if (active.length === 0) return [];
  active.sort((a, b) => a.bin - b.bin);
  const segments = [];
  let seg = [active[0]];
  for (let i = 1; i < active.length; i++) {
    if (active[i].bin - active[i - 1].bin > maxGap) {
      segments.push(seg);
      seg = [active[i]];
    } else {
      seg.push(active[i]);
    }
  }
  segments.push(seg);
  const big = segments.filter((s) => s.length >= minSegLen);
  if (big.length === 0) return [];
  big.sort((a, b) => a[0].bin - b[0].bin);
  const pivot = big.reduce((best, s) => (s[0].bin > best[0].bin ? s : best), big[0]);
  const start = big.indexOf(pivot);
  return big.slice(start).concat(big.slice(0, start));
}

function smoothSegment(points, passes = 5, alpha = 0.45) {
  if (points.length < 3) return points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  let pts = points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  for (let pass = 0; pass < passes; pass++) {
    const next = pts.map((p, i) => {
      const prev = pts[Math.max(0, i - 1)];
      const succ = pts[Math.min(pts.length - 1, i + 1)];
      const w = i === 0 || i === pts.length - 1 ? alpha * 0.5 : alpha;
      return {
        x: p.x * (1 - w) + (prev.x + succ.x) * 0.5 * w,
        y: p.y * (1 - w) + (prev.y + succ.y) * 0.5 * w,
        z: p.z * (1 - w) + (prev.z + succ.z) * 0.5 * w,
      };
    });
    pts = next;
  }
  return pts;
}

function splitAtGaps(points, maxGap = 25) {
  if (points.length === 0) return [];
  const chunks = [[points[0]]];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const d = Math.hypot(cur.x - prev.x, cur.z - prev.z);
    if (d > maxGap) chunks.push([]);
    chunks[chunks.length - 1].push(cur);
  }
  return chunks.filter((c) => c.length >= 2);
}

function dropSpuriousSegments(segments, minLen = 20) {
  return segments.filter((seg) => seg.length >= minLen);
}

function trimTailPastLastMark(chunk, spacing) {
  if (chunk.length < 2) return chunk;
  let dist = 0;
  let nextMark = 0;
  const marks = [];
  for (let i = 0; i < chunk.length; i++) {
    if (i > 0) dist += Math.hypot(chunk[i].x - chunk[i - 1].x, chunk[i].z - chunk[i - 1].z);
    while (dist >= nextMark) {
      marks.push({ i, nextMark });
      nextMark += spacing;
    }
  }
  if (marks.length < 2) return chunk;
  const last = marks[marks.length - 1];
  const remainder = dist - last.nextMark;
  if (remainder > 0 && remainder < spacing) {
    return chunk.slice(0, marks[marks.length - 2].i + 1);
  }
  return chunk;
}

function trimHeadFromMark(chunk, skipMarks, spacing) {
  let dist = 0;
  let nextMark = 0;
  let markIdx = 0;
  for (let i = 0; i < chunk.length; i++) {
    if (i > 0) dist += Math.hypot(chunk[i].x - chunk[i - 1].x, chunk[i].z - chunk[i - 1].z);
    while (dist >= nextMark) {
      if (markIdx === skipMarks) return chunk.slice(i);
      markIdx++;
      nextMark += spacing;
    }
  }
  return chunk;
}

function trimTailExtraMarks(chunk, spacing, dropCount = 1) {
  if (chunk.length < 2) return chunk;
  let dist = 0;
  let nextMark = 0;
  const marks = [];
  for (let i = 0; i < chunk.length; i++) {
    if (i > 0) dist += Math.hypot(chunk[i].x - chunk[i - 1].x, chunk[i].z - chunk[i - 1].z);
    while (dist >= nextMark) {
      marks.push({ i, nextMark });
      nextMark += spacing;
    }
  }
  if (marks.length <= dropCount + 1) return chunk;
  const last = marks[marks.length - 1];
  const remainder = dist - last.nextMark;
  if (remainder > 0 && remainder < spacing) {
    return chunk.slice(0, marks[marks.length - dropCount - 1].i + 1);
  }
  return chunk;
}

function trimLoopEnds(points, spacing = 12, maxGap = 25) {
  const chunks = splitAtGaps(trimGapTails(points, spacing, maxGap), maxGap);
  if (chunks.length === 0) return points;
  chunks[0] = trimHeadFromMark(chunks[0], 1, spacing);
  chunks[chunks.length - 1] = trimTailExtraMarks(chunks[chunks.length - 1], spacing, 2);
  return chunks.flat();
}

function trimGapTails(points, spacing = 12, maxGap = 25) {
  const chunks = splitAtGaps(points, maxGap);
  if (chunks.length <= 1) return points;
  const out = [];
  for (let c = 0; c < chunks.length; c++) {
    const chunk = c < chunks.length - 1
      ? trimTailPastLastMark(chunks[c], spacing)
      : chunks[c];
    out.push(...chunk);
  }
  return out;
}

function normalizeLoop(loop, closeMaxGap = 25) {
  const cumulative = [0];
  for (let i = 1; i < loop.length; i++) {
    cumulative[i] = cumulative[i - 1] + Math.hypot(
      loop[i].x - loop[i - 1].x,
      loop[i].y - loop[i - 1].y,
      loop[i].z - loop[i - 1].z,
    );
  }
  const last = loop[loop.length - 1];
  const close = Math.hypot(last.x - loop[0].x, last.y - loop[0].y, last.z - loop[0].z);
  const total = cumulative[cumulative.length - 1] + (close <= closeMaxGap ? close : 0);
  return loop.map((p, i) => ({
    u: Number((total > 0 ? cumulative[i] / total : 0).toFixed(5)),
    x: Number(p.x.toFixed(3)),
    y: Number(p.y.toFixed(3)),
    z: Number(p.z.toFixed(3)),
  }));
}

const segments = dropSpuriousSegments(splitActiveSegments(polarCenterline(points)));
const loop = segments
  .map((seg) => smoothSegment(seg.map((p) => ({ x: p.x, y: p.y, z: p.z }))))
  .flat();
const normalized = normalizeLoop(trimLoopEnds(loop.slice().reverse()));
fs.writeFileSync(outPath, JSON.stringify(normalized));

let len = 0;
for (let i = 1; i < normalized.length; i++) {
  len += Math.hypot(
    normalized[i].x - normalized[i - 1].x,
    normalized[i].y - normalized[i - 1].y,
    normalized[i].z - normalized[i - 1].z,
  );
}
console.log('wrote', outPath, 'points:', normalized.length, 'length ~', len.toFixed(0), 'm');
