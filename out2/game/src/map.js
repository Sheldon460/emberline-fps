// Emberline — map: the Emberworks Yard, an original dusk foundry yard.
// Two bomb sites (A furnace hall, B crane dock), a mid lane and two flanks,
// all cover as boxes so movement, sight and shooting share one collider list.
import * as THREE from 'three';

// Dusk-foundry palette: warm orange accent, slate/teal shadows, amber site light.
export const PALETTE = {
  ground: 0x2b2f36,
  groundDark: 0x23262c,
  wall: 0x3a3f47,
  wallTop: 0x4a4f58,
  crate: 0x6b5a44,
  crateDark: 0x54432f,
  steel: 0x55606e,
  steelDark: 0x39424e,
  furnace: 0x7a3b22,
  pipe: 0xb0703a,
  containerA: 0x9a4a1f,
  containerB: 0x2f6f6a,
  accent: 0xf97316,
  amber: 0xffb347,
  emberTeam: 0xf97316,
  ashTeam: 0x59b8c4,
};

export const BOUNDS = { x0: -32, x1: 32, z0: -22, z1: 22 };

export const SITES = {
  A: { x: -22, z: -11, r: 5, name: 'A · 炉膛' },
  B: { x: 22, z: -11, r: 5, name: 'B · 吊机码头' },
};

export const SPAWNS = {
  ember: { x: 0, z: 17 },
  ash: { x: 0, z: -17 },
};

// Waypoint graph: nodes on the three lanes, edges by index.
export const WAYPOINTS = [
  { x: 0, z: 17 },   // 0 ember spawn
  { x: 0, z: 10 },   // 1 mid south
  { x: 0, z: 2 },    // 2 mid
  { x: 0, z: -6 },   // 3 mid north
  { x: -12, z: -6 }, // 4 A approach
  { x: -22, z: -11 },// 5 A site
  { x: -24, z: 2 },  // 6 A west
  { x: -14, z: 8 },  // 7 west mid
  { x: 12, z: -6 },  // 8 B approach
  { x: 22, z: -11 }, // 9 B site
  { x: 24, z: 2 },   // 10 B east
  { x: 14, z: 8 },   // 11 east mid
  { x: 0, z: -17 },  // 12 ash spawn
  { x: -8, z: -14 }, // 13 A north cut
  { x: 8, z: -14 },  // 14 B north cut
];
export const EDGES = [
  [1, 7, 11], [0, 2, 7, 11], [1, 3, 7, 11], [2, 4, 8, 12, 13, 14],
  [3, 5, 6, 13], [4, 6], [4, 5, 7], [0, 1, 2, 6],
  [3, 9, 10, 14], [8, 10], [8, 9, 11], [0, 1, 2, 10],
  [3], [3, 4], [3, 8],
];

export function buildMap(scene) {
  const colliders = [];
  const meshes = [];
  const mats = {};
  const mat = (key, color, opts = {}) => {
    if (!mats[key]) mats[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.08, ...opts });
    return mats[key];
  };

  function box(x, y, z, w, h, d, material, collide = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y + h / 2, z);
    scene.add(m);
    meshes.push(m);
    if (collide) colliders.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0: y, y1: y + h });
    return m;
  }
  function cyl(x, y, z, rTop, rBot, h, material, collide = true) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 12), material);
    m.position.set(x, y + h / 2, z);
    scene.add(m);
    meshes.push(m);
    if (collide) colliders.push({ x0: x - rBot, x1: x + rBot, z0: z - rBot, z1: z + rBot, y0: y, y1: y + h });
    return m;
  }

  // Ground + yard patches.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 44), mat('ground', PALETTE.ground));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const patch = (x, z, w, d) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat('groundDark', PALETTE.groundDark));
    p.rotation.x = -Math.PI / 2; p.position.set(x, 0.01, z); scene.add(p);
  };
  patch(-22, -11, 14, 12); patch(22, -11, 14, 12); patch(0, 2, 10, 26);

  // Perimeter walls.
  box(0, 0, -22.5, 66, 5, 1, mat('wall', PALETTE.wall));
  box(0, 0, 22.5, 66, 5, 1, mat('wall', PALETTE.wall));
  box(-32.5, 0, 0, 1, 5, 46, mat('wall', PALETTE.wall));
  box(32.5, 0, 0, 1, 5, 46, mat('wall', PALETTE.wall));
  box(0, 5, -22.5, 66, 0.4, 1.2, mat('wallTop', PALETTE.wallTop), false);
  box(0, 5, 22.5, 66, 0.4, 1.2, mat('wallTop', PALETTE.wallTop), false);

  // --- Site A: furnace hall (west-north) ---
  box(-26, 0, -14, 5, 5, 6, mat('furnace', PALETTE.furnace)); // furnace body
  box(-26, 5, -14, 5.6, 0.5, 6.6, mat('steelDark', PALETTE.steelDark)); // furnace cap
  cyl(-23.2, 0, -16.5, 0.5, 0.6, 7, mat('pipe', PALETTE.pipe)); // chimney
  cyl(-28.5, 0, -11, 0.4, 0.5, 6, mat('pipe', PALETTE.pipe));
  box(-19, 0, -16, 3, 1.2, 1.2, mat('crate', PALETTE.crate)); // low cover
  box(-19, 0, -6, 2, 2, 2, mat('crateDark', PALETTE.crateDark));
  box(-25, 0, -5, 2.4, 1.2, 1.2, mat('steel', PALETTE.steel));

  // --- Site B: crane dock (east-north) ---
  box(26, 0, -15, 5, 2.6, 3, mat('containerA', PALETTE.containerA)); // container
  box(26, 2.6, -15, 5, 2.6, 3, mat('containerB', PALETTE.containerB)); // stacked
  box(19, 0, -16, 2, 2, 2, mat('crate', PALETTE.crate));
  box(20, 0, -6, 2.4, 1.2, 1.2, mat('steel', PALETTE.steel));
  // Crane legs + beam (no collide on the high beam).
  box(24, 0, -18, 0.8, 8, 0.8, mat('steelDark', PALETTE.steelDark));
  box(24, 0, -8, 0.8, 8, 0.8, mat('steelDark', PALETTE.steelDark));
  box(24, 7.6, -13, 0.8, 0.8, 10.8, mat('steelDark', PALETTE.steelDark), false);

  // --- Mid lane cover (offset from the spawn-to-spawn sightline) ---
  box(-4, 0, 5, 3, 1.4, 1.4, mat('crate', PALETTE.crate));
  box(-2.5, 0, -1, 1.6, 1.6, 1.6, mat('crateDark', PALETTE.crateDark));
  box(3, 0, -3.5, 2, 1.1, 1.1, mat('steel', PALETTE.steel));
  box(0, 0, -9, 1.4, 1.4, 3.2, mat('crate', PALETTE.crate));

  // --- Flank cover ---
  box(-14, 0, 8, 2, 1.2, 2, mat('crate', PALETTE.crate));
  box(-14, 0, -2, 1.6, 1.6, 1.6, mat('crateDark', PALETTE.crateDark));
  box(-8, 0, 12, 2.4, 1.1, 1.1, mat('steel', PALETTE.steel));
  box(14, 0, 8, 2, 1.2, 2, mat('crate', PALETTE.crate));
  box(14, 0, -2, 1.6, 1.6, 1.6, mat('crateDark', PALETTE.crateDark));
  box(8, 0, 12, 2.4, 1.1, 1.1, mat('steel', PALETTE.steel));

  // --- Spawn cover + pipes along the south wall ---
  box(-6, 0, 18, 3, 1.2, 1.2, mat('crate', PALETTE.crate));
  box(6, 0, 18, 3, 1.2, 1.2, mat('crate', PALETTE.crate));
  box(-6, 0, -18, 3, 1.2, 1.2, mat('crate', PALETTE.crate));
  box(6, 0, -18, 3, 1.2, 1.2, mat('crate', PALETTE.crate));
  cyl(-30, 0, 20, 0.5, 0.5, 3.4, mat('pipe', PALETTE.pipe));
  cyl(30, 0, 20, 0.5, 0.5, 3.4, mat('pipe', PALETTE.pipe));

  // --- Distant skyline silhouettes (outside the walls, no collide) ---
  const skyMat = new THREE.MeshBasicMaterial({ color: 0x1c1420 });
  const skyline = [[-40, -30, 8, 14], [-20, -34, 12, 20], [4, -32, 9, 11], [24, -34, 14, 24], [40, -28, 7, 12], [-42, 26, 10, 16], [42, 26, 9, 13]];
  for (const [x, z, w, h] of skyline) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 4), skyMat);
    m.position.set(x, h / 2, z);
    scene.add(m);
  }

  // --- Site markers: glowing amber rings on the ground ---
  const ringMat = new THREE.MeshBasicMaterial({ color: PALETTE.amber, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  for (const key of Object.keys(SITES)) {
    const s = SITES[key];
    const ring = new THREE.Mesh(new THREE.RingGeometry(s.r - 0.35, s.r, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.03, s.z);
    scene.add(ring);
  }

  // --- Lights: low dusk sun, hemisphere fill, amber site lights ---
  const hemi = new THREE.HemisphereLight(0x8a5a7a, 0x1e2228, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xff8c3a, 1.6);
  sun.position.set(-30, 26, 18);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x4a7a8a, 0.5);
  fill.position.set(20, 18, -20);
  scene.add(fill);
  for (const key of Object.keys(SITES)) {
    const s = SITES[key];
    const pl = new THREE.PointLight(PALETTE.amber, 14, 18, 1.6);
    pl.position.set(s.x, 3.5, s.z);
    scene.add(pl);
  }

  scene.fog = new THREE.Fog(0x2a1a24, 45, 95);
  scene.background = new THREE.Color(0x241722);

  return { colliders, meshes, sites: SITES, spawns: SPAWNS, waypoints: WAYPOINTS, edges: EDGES, bounds: BOUNDS };
}

// Breadth-first path over the waypoint graph. Returns an array of node
// indices from `from` to `to` (inclusive), or [to] when unreachable.
export function findPath(from, to) {
  if (from === to) return [to];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const n = queue.shift();
    for (const m of EDGES[n]) {
      if (prev[m] !== -1) continue;
      prev[m] = n;
      if (m === to) {
        const path = [to];
        let c = to;
        while (c !== from) { c = prev[c]; path.unshift(c); }
        return path;
      }
      queue.push(m);
    }
  }
  return [to];
}

export function nearestWaypoint(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const dx = WAYPOINTS[i].x - x, dz = WAYPOINTS[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
