// Emberline — utils: seeded RNG + allocation-free geometry helpers.
// No per-frame allocations in the hot loops: every helper takes scalars.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    int: (lo, hi) => Math.floor(lo + next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// Ray (origin o, direction d, assumed normalised) vs AABB.
// Box: {x0,y0,z0,x1,y1,z1}. Returns nearest t >= 0, or -1.
export function rayAABB(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0, tmax = Infinity;
  let o, d, lo, hi, inv, t1, t2;
  o = ox; d = dx; lo = b.x0; hi = b.x1;
  if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return -1; }
  else { inv = 1 / d; t1 = (lo - o) * inv; t2 = (hi - o) * inv; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
  o = oy; d = dy; lo = b.y0; hi = b.y1;
  if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return -1; }
  else { inv = 1 / d; t1 = (lo - o) * inv; t2 = (hi - o) * inv; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
  o = oz; d = dz; lo = b.z0; hi = b.z1;
  if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return -1; }
  else { inv = 1 / d; t1 = (lo - o) * inv; t2 = (hi - o) * inv; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
  return tmin;
}

// Ray vs sphere (centre c, radius r). Returns nearest t >= 0, or -1.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  return tca - Math.sqrt(r2 - d2);
}

// Segment (a->b) vs AABB: true when blocked. Used for bot line-of-sight.
export function segmentBlocked(ax, ay, az, bx, by, bz, colliders) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return false;
  const ix = dx / len, iy = dy / len, iz = dz / len;
  for (let i = 0; i < colliders.length; i++) {
    const t = rayAABB(ax, ay, az, ix, iy, iz, colliders[i]);
    if (t >= 0 && t < len) return true;
  }
  return false;
}

// Segment vs sphere (smoke clouds): true when the segment passes through.
export function segmentHitsSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1e-9) return false;
  let t = ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + dx * t - cx, py = ay + dy * t - cy, pz = az + dz * t - cz;
  return px * px + py * py + pz * pz < r * r;
}

// Circle (x,z,r) vs AABB list, 2D push-out for movement collision.
// Mutates p {x,z} in place. Returns true when a push happened.
export function collideCircle(p, r, colliders) {
  let pushed = false;
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (b.y1 < 0.4) continue; // low trim the player steps over visually; still blocks
    const cx = clamp(p.x, b.x0, b.x1);
    const cz = clamp(p.z, b.z0, b.z1);
    const ddx = p.x - cx, ddz = p.z - cz;
    const d2 = ddx * ddx + ddz * ddz;
    if (d2 >= r * r) continue;
    pushed = true;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      p.x = cx + (ddx / d) * r;
      p.z = cz + (ddz / d) * r;
    } else {
      // Centre inside the box: push out along the smallest penetration axis.
      const pl = p.x - b.x0, pr = b.x1 - p.x, pt = p.z - b.z0, pb = b.z1 - p.z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) p.x = b.x0 - r;
      else if (m === pr) p.x = b.x1 + r;
      else if (m === pt) p.z = b.z0 - r;
      else p.z = b.z1 + r;
    }
  }
  return pushed;
}
