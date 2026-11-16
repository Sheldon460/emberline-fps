// Emberline — main: boot, fixed 60 Hz sim loop, combat resolution
// (raycast vs walls and bodies), grenades, tracers and the ?shot= runner.
import * as THREE from 'three';
import { createState } from './state.js';
import { buildMap, SITES } from './map.js';
import { createPlayer } from './player.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { WEAPONS, shotSpread, stepGrenade } from './weapons.js';
import { rayAABB, raySphere, segmentBlocked, clamp } from './utils.js';

const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') || 1);
const SHOT = params.get('shot') || '';
window.__shotMode = !!SHOT;
window.__shotReady = false;

const S = createState(SEED);
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const map = buildMap(scene);
const audio = createAudio();
const input = createInput(canvas);

const ctx = { S, map, scene, camera, audio, input };
ctx.player = createPlayer(ctx);
ctx.bots = createBots(ctx);
ctx.rounds = createRounds(ctx);
ctx.hud = createHud(ctx);

// --- Weapon viewmodel (a simple gun attached to the camera) ---
const gun = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.6, metalness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.5, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.5), dark);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.3), dark);
  barrel.position.set(0, 0.02, -0.36);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.02, 0.3), accent);
  stripe.position.set(0, 0.05, -0.1);
  gun.add(body, barrel, stripe);
  gun.position.set(0.26, -0.22, -0.45);
  camera.add(gun);
}

// --- Tracer pool (no allocation per shot) ---
const TRACERS = [];
for (let i = 0; i < 24; i++) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 }));
  line.frustumCulled = false;
  scene.add(line);
  TRACERS.push({ line, ttl: 0 });
}
let tracerIdx = 0;
function spawnTracer(x1, y1, z1, x2, y2, z2) {
  const t = TRACERS[tracerIdx];
  tracerIdx = (tracerIdx + 1) % TRACERS.length;
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, x1, y1, z1);
  pos.setXYZ(1, x2, y2, z2);
  pos.needsUpdate = true;
  t.line.material.opacity = 0.9;
  t.ttl = 0.09;
}

// --- Bomb mesh (planted / dropped) ---
const bombMesh = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.26),
    new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.5 }));
  const light = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.05),
    new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
  light.position.set(0, 0.13, 0);
  bombMesh.add(body, light);
  bombMesh.visible = false;
  scene.add(bombMesh);
}
// --- Smoke visuals ---
const smokeMeshes = new Map(); // smoke object -> mesh
const smokeGeo = new THREE.SphereGeometry(1, 14, 10);
function syncSmokes() {
  for (const s of S.smokes) {
    let m = smokeMeshes.get(s);
    if (!m) {
      m = new THREE.Mesh(smokeGeo, new THREE.MeshStandardMaterial({ color: 0x9aa4ae, transparent: true, opacity: 0.42, roughness: 1 }));
      scene.add(m);
      smokeMeshes.set(s, m);
    }
    m.position.set(s.x, s.y, s.z);
    m.scale.setScalar(s.r);
  }
  for (const [s, m] of smokeMeshes) {
    if (!S.smokes.includes(s)) { scene.remove(m); m.material.dispose(); smokeMeshes.delete(s); }
  }
}
// --- Explosion visual ---
const explosionMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0 }));
scene.add(explosionMesh);
let explosionT = 0;

const _eye = { x: 0, y: 0, z: 0 };
const _dir = { x: 0, y: 0, z: 0 };

// Raycast a shot. origin/direction are plain objects; returns the hit or null.
function raycastShot(ox, oy, oz, dx, dy, dz, shooter) {
  let bestT = Infinity;
  let best = null;
  // Walls first.
  for (const c of map.colliders) {
    const t = rayAABB(ox, oy, oz, dx, dy, dz, c);
    if (t >= 0 && t < bestT) { bestT = t; best = { kind: 'wall', t }; }
  }
  // Bodies: the player and every bot except the shooter.
  const targets = [];
  if (shooter !== 'player' && S.player.alive) targets.push({ kind: 'player', x: S.player.x, z: S.player.z });
  for (const b of S.bots) {
    if (!b.alive || b.id === shooter) continue;
    targets.push({ kind: 'bot', bot: b, x: b.x, z: b.z });
  }
  for (const tg of targets) {
    // Head sphere, torso box, legs box: take whichever the ray meets first.
    const tHead = raySphere(ox, oy, oz, dx, dy, dz, tg.x, 1.58, tg.z, 0.21);
    const tTorso = rayAABB(ox, oy, oz, dx, dy, dz, { x0: tg.x - 0.28, x1: tg.x + 0.28, y0: 0.85, y1: 1.48, z0: tg.z - 0.28, z1: tg.z + 0.28 });
    const tLegs = rayAABB(ox, oy, oz, dx, dy, dz, { x0: tg.x - 0.26, x1: tg.x + 0.26, y0: 0, y1: 0.85, z0: tg.z - 0.26, z1: tg.z + 0.26 });
    let t = -1, part = '';
    if (tHead >= 0 && tHead < bestT) { t = tHead; part = 'head'; }
    if (tTorso >= 0 && tTorso < bestT && (t < 0 || tTorso < t)) { t = tTorso; part = 'torso'; }
    if (tLegs >= 0 && tLegs < bestT && (t < 0 || tLegs < t)) { t = tLegs; part = 'legs'; }
    if (t >= 0) { bestT = t; best = { kind: 'hit', part, target: tg, t }; }
  }
  if (!best) return null;
  return {
    ...best,
    x: ox + dx * bestT, y: oy + dy * bestT, z: oz + dz * bestT, dist: bestT,
  };
}

function applyDamage(target, dmg, part, shooterName, shooterTeam) {
  const P = S.player;
  if (target.kind === 'player') {
    if (!P.alive) return;
    let d = dmg * (part === 'head' ? 4 : part === 'legs' ? 0.7 : 1);
    if (P.kevlar) d *= 0.65;
    P.hp -= d;
    P.damage += d;
    audio.hurt();
    flashDamage();
    if (P.hp <= 0) {
      P.hp = 0;
      ctx.rounds.onPlayerDeath();
      ctx.rounds.addFeed(`${shooterName} 击杀了 你`, 'ash');
    }
    return;
  }
  const bot = target.bot;
  if (!bot.alive) return;
  let d = dmg * (part === 'head' ? 4 : part === 'legs' ? 0.7 : 1);
  if (bot.kevlar) d *= 0.65;
  bot.hp -= d;
  const crit = part === 'head';
  if (shooterTeam === 'ember') {
    ctx.hud.showHitmarker(crit);
    audio.hit(crit);
    S.hits.push({ x: bot.x, y: 1.7, z: bot.z, text: `${Math.round(d)}`, ttl: 0.7, crit });
    P.damage += d;
  }
  if (bot.hp <= 0) {
    bot.hp = 0;
    ctx.bots.killBot(bot, shooterName);
    S.roundKills[shooterTeam === 'ember' ? 'ember' : 'ash']++;
    if (shooterTeam === 'ember') {
      P.kills++;
      P.money += 300;
      audio.kill();
      ctx.rounds.addFeed(`你 击杀了 ${bot.name}${crit ? ' · 爆头' : ''}`, 'ember');
    } else {
      ctx.rounds.addFeed(`${shooterName} 击杀了 ${bot.name}`, 'ash');
    }
    // Low-hp teammates fall back.
    for (const o of S.bots) {
      if (o.alive && o.team === bot.team && o.hp < 45) o.state = 'hold';
    }
  }
}

function flashDamage() {
  const f = document.getElementById('damage-flash');
  if (!f) return;
  f.style.opacity = '0.55';
  setTimeout(() => { f.style.opacity = '0'; }, 130);
}

function jitterDir(spreadDeg) {
  // Perturb the player's aim by a small random cone. Pure yaw/pitch math,
  // so it is correct before the first render as well as after.
  const P = S.player;
  const cp = Math.cos(P.pitch), sp = Math.sin(P.pitch);
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
  const fx = -sy * cp, fy = sp, fz = -cy * cp;
  const rx = cy, rz = -sy;
  // up = right x forward
  const ux = sy * fy, uy = -(cy * fz + sy * fx), uz = cy * fy;
  const s = (spreadDeg * Math.PI) / 180;
  const r = (S.rng.next() + S.rng.next() + S.rng.next() - 1.5) / 1.5;
  const r2 = (S.rng.next() + S.rng.next() + S.rng.next() - 1.5) / 1.5;
  _dir.x = fx + rx * r * s + ux * r2 * s;
  _dir.y = fy + uy * r2 * s;
  _dir.z = fz + rz * r * s + uz * r2 * s;
  const len = Math.hypot(_dir.x, _dir.y, _dir.z) || 1;
  _dir.x /= len; _dir.y /= len; _dir.z /= len;
  return _dir;
}

// The player's shot, fired from the camera.
function shootPlayer() {
  const P = S.player;
  const w = WEAPONS[P.weapon];
  const eye = ctx.player.eyePos(_eye);
  const pellets = w.pellets || 1;
  const spread = shotSpread(w, P);
  for (let i = 0; i < pellets; i++) {
    const dir = jitterDir(spread);
    const hit = raycastShot(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 'player');
    const end = hit || { x: eye.x + dir.x * w.range, y: eye.y + dir.y * w.range, z: eye.z + dir.z * w.range };
    spawnTracer(eye.x, eye.y - 0.08, eye.z, end.x, end.y, end.z);
    if (hit && hit.kind === 'hit') applyDamage(hit.target, w.damage, hit.part, '你', 'ember');
  }
  S.shotsFired++;
  audio.shot(w.kind);
  ctx.bots.hearShot(P.x, P.z, 'ember');
}

// A bot's shot toward a target point, with spread in degrees.
function shootBot(bot, tx, tz, spreadDeg) {
  const w = WEAPONS[bot.weapon];
  const oy = 1.5;
  const dx0 = tx - bot.x, dz0 = tz - bot.z;
  const dist = Math.hypot(dx0, dz0) || 1;
  const ty = 1.35;
  let dx = dx0 / dist, dy = (ty - oy) / dist, dz = dz0 / dist;
  const s = (spreadDeg * Math.PI) / 180;
  const r = (S.rng.next() + S.rng.next() - 1) * s;
  const r2 = (S.rng.next() + S.rng.next() - 1) * s;
  const ndx = dx + -dz * r;
  const ndz = dz + dx * r;
  dx = ndx; dz = ndz; dy += r2;
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len; dy /= len; dz /= len;
  const hit = raycastShot(bot.x, oy, bot.z, dx, dy, dz, bot.id);
  const end = hit || { x: bot.x + dx * w.range, y: oy + dy * w.range, z: bot.z + dz * w.range };
  spawnTracer(bot.x, oy, bot.z, end.x, end.y, end.z);
  if (hit && hit.kind === 'hit') {
    const target = hit.target;
    const shooterTeam = bot.team;
    applyDamage(target, w.damage, hit.part, bot.name, shooterTeam);
    if (target.kind === 'player') ctx.bots.hearShot(bot.x, bot.z, 'ash');
  }
}
ctx.shootBot = shootBot;

// --- Grenades ---
function updateGrenades(dt) {
  for (let i = S.grenades.length - 1; i >= 0; i--) {
    const g = S.grenades[i];
    stepGrenade(g, dt);
    if (g.fuse > 0) continue;
    S.grenades.splice(i, 1);
    if (g.kind === 'frag') {
      explosionT = 0.5;
      explosionMesh.position.set(g.x, 0.8, g.z);
      audio.explosion();
      const victims = [];
      if (S.player.alive) victims.push({ kind: 'player', x: S.player.x, z: S.player.z });
      for (const b of S.bots) if (b.alive) victims.push({ kind: 'bot', bot: b, x: b.x, z: b.z });
      for (const v of victims) {
        const d = Math.hypot(v.x - g.x, v.z - g.z);
        if (d > 9) continue;
        if (segmentBlocked(g.x, 1, g.z, v.x, 1.2, v.z, map.colliders)) continue;
        const dmg = 110 * (1 - d / 11);
        if (v.kind === 'player') applyDamage(v, dmg, 'torso', '手雷', 'ash');
        else applyDamage(v, dmg, 'torso', '手雷', v.bot.team === 'ember' ? 'ash' : 'ember');
      }
    } else {
      S.smokes.push({ x: g.x, y: 1.2, z: g.z, r: 4.5, ttl: 12 });
    }
  }
  for (let i = S.smokes.length - 1; i >= 0; i--) {
    S.smokes[i].ttl -= dt;
    if (S.smokes[i].ttl <= 0) S.smokes.splice(i, 1);
  }
}

// --- Sim step (fixed 1/60 s) ---
function simStep(dt) {
  // Player (only while alive; a dead player stops moving and spectates).
  if (S.player.alive && (S.phase === 'live' || S.phase === 'freeze')) {
    ctx.player.update(dt);
    if (S.phase === 'live' && input.firing && ctx.player.fireCooldown() <= 0) {
      if (ctx.player.tryFire()) shootPlayer();
    }
  } else {
    input.consumeMouse();
    input.consumePressed();
  }
  ctx.bots.update(dt);
  ctx.rounds.update(dt);
  ctx.rounds.afterRoundEnd(dt);
  updateGrenades(dt);
  for (const t of TRACERS) {
    if (t.ttl > 0) { t.ttl -= dt; t.line.material.opacity = Math.max(0, t.ttl / 0.09) * 0.9; }
  }
  if (explosionT > 0) {
    explosionT -= dt;
    const k = 1 - explosionT / 0.5;
    explosionMesh.scale.setScalar(1 + k * 8);
    explosionMesh.material.opacity = Math.max(0, 0.7 * (1 - k));
  }
  // Bomb mesh follows the bomb.
  const bomb = S.bomb;
  if (bomb.state === 'planted' || bomb.state === 'dropped') {
    bombMesh.visible = true;
    bombMesh.position.set(bomb.x, 0.12, bomb.z);
  } else bombMesh.visible = false;
  syncSmokes();
}

// --- Render ---
let walkPhase = 0;
function render() {
  const P = S.player;
  if (P.alive) {
    camera.position.set(P.x, camera.position.y, P.z);
    camera.rotation.y = P.yaw;
    camera.rotation.x = P.pitch + P.recoil * 0.4;
    const targetFov = P.ads ? 55 : 75;
    if (Math.abs(camera.fov - targetFov) > 0.2) {
      camera.fov += (targetFov - camera.fov) * 0.25;
      camera.updateProjectionMatrix();
    }
  } else {
    // Spectate the first living teammate.
    const mate = S.bots.find((b) => b.team === 'ember' && b.alive);
    if (mate) {
      camera.position.set(mate.x, 1.55, mate.z);
      camera.rotation.y = mate.yaw;
      camera.rotation.x = 0;
    }
  }
  // Gun bob + recoil.
  walkPhase += (P.moving && P.alive ? 0.12 : 0.02);
  gun.position.y = -0.22 + Math.sin(walkPhase) * (P.moving ? 0.008 : 0.002);
  gun.position.z = -0.45 + P.recoil * 1.4;
  gun.visible = P.alive && S.phase !== 'lobby';
  renderer.render(scene, camera);
}

// Keep the camera's eye height in step with the player's crouch.
let lastEyeH = 1.62;
function syncCameraY() {
  const P = S.player;
  const target = P.crouched ? 1.05 : 1.62;
  lastEyeH += (target - lastEyeH) * 0.25;
  if (P.alive) camera.position.y = lastEyeH;
}

// --- Main loop ---
const STEP = 1 / 60;
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 5) {
    simStep(STEP);
    acc -= STEP;
    n++;
  }
  syncCameraY();
  render();
  ctx.hud.update(dt, camera);
}

// --- Keys that are not movement ---
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyB' && (S.phase === 'freeze' || (S.phase === 'live' && S.timer > 100))) {
    ctx.hud.setBuyVisible(!ctx.hud.isBuyVisible());
    if (!input.locked) input.lock();
  }
  if (e.code === 'Digit1' && ctx.hud.isBuyVisible()) ctx.rounds.buy('vandal');
  if (e.code === 'Digit2' && ctx.hud.isBuyVisible()) ctx.rounds.buy('whisper');
  if (e.code === 'Digit3' && ctx.hud.isBuyVisible()) ctx.rounds.buy('scatter');
  if (e.code === 'Digit4' && ctx.hud.isBuyVisible()) ctx.rounds.buy('longshot');
  if (e.code === 'Digit5' && ctx.hud.isBuyVisible()) ctx.rounds.buy('kevlar');
  if (e.code === 'Digit6' && ctx.hud.isBuyVisible()) ctx.rounds.buy('frag');
  if (e.code === 'Digit7' && ctx.hud.isBuyVisible()) ctx.rounds.buy('smoke');
  if (e.code === 'KeyM') { const m = audio.toggleMute(); ctx.rounds.addFeed(m ? '已静音' : '取消静音', 'sys'); }
});
input.onFirstGesture = () => audio.unlock();
input.onLockChange = (locked) => {
  if (!locked && S.phase === 'lobby') { /* stay on the start overlay */ }
};

// Start overlay click: begin the match and lock the pointer.
document.getElementById('overlay-start').addEventListener('click', () => {
  audio.unlock();
  input.lock();
  if (S.phase === 'lobby') ctx.rounds.startMatch();
});
document.getElementById('overlay-end').addEventListener('click', () => {
  audio.unlock();
  input.lock();
  if (S.phase === 'matchEnd') ctx.rounds.startMatch();
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- ?shot= deterministic setups for the entry screenshots ---
function runShotMode() {
  ctx.rounds.startMatch();
  const P = S.player;
  if (SHOT === 'start') {
    // Spawn overview with the buy menu open.
    S.phase = 'freeze';
    S.phaseT = 3;
    P.x = 0; P.z = 17; P.yaw = 0; P.pitch = 0.03;
    ctx.hud.setBuyVisible(true);
  } else if (SHOT === 'play') {
    S.phase = 'live';
    P.x = 3; P.z = 7; P.yaw = 0.22; P.pitch = 0.0;
    P.weapon = 'vandal'; P.mag = 30; P.reserve = 90;
    // An Ash bot ahead in the mid lane, back turned; one Ember mate ahead-left.
    const foe = S.bots.find((b) => b.team === 'ash');
    foe.x = 1; foe.z = -2; foe.yaw = 0.3; foe.state = 'hold'; foe.holdT = 5;
    const mate = S.bots.find((b) => b.team === 'ember');
    mate.x = -3; mate.z = 2; mate.yaw = 0; mate.state = 'hold'; mate.holdT = 5;
  } else if (SHOT === 'objective') {
    S.phase = 'live';
    P.x = -16; P.z = -6; P.yaw = 0.9; P.pitch = 0.02;
    const mate = S.bots.find((b) => b.team === 'ember');
    mate.x = -18; mate.z = -13; mate.yaw = Math.PI / 2; mate.state = 'hold'; mate.holdT = 5;
    const foe = S.bots.find((b) => b.team === 'ash');
    foe.x = -12; foe.z = -14; foe.yaw = 2.1; foe.state = 'hold'; foe.holdT = 5;
  } else if (SHOT === 'end') {
    S.phase = 'roundEnd';
    S.phaseT = 4;
    S.roundWinner = 'ember';
    S.roundReason = '全歼 Ash · 炉膛守住了';
    S.score.ember = 1;
    P.x = 0; P.z = 8; P.yaw = 0; P.pitch = 0.05;
    P.weapon = 'vandal'; P.mag = 24; P.reserve = 90;
    const mate = S.bots.find((b) => b.team === 'ember');
    mate.x = -3; mate.z = 3; mate.yaw = 0; mate.state = 'hold'; mate.holdT = 5;
  }
  // Settle the sim so bodies and the HUD are in their final pose.
  for (let i = 0; i < 30; i++) simStep(STEP);
  // Then the action that must be fresh in the frame: a real shot (with its
  // tracer, hitmarker and damage number) or the plant in progress.
  if (SHOT === 'play') {
    ctx.player.tryFire();
    shootPlayer();
    ctx.hud.showHitmarker(false);
  } else if (SHOT === 'objective') {
    P.planting = true;
    P.plantT = 2.1;
  }
  syncCameraY();
  render();
  ctx.hud.update(0.016, camera);
  render();
  window.__shotReady = true;
}

if (SHOT) {
  runShotMode();
} else {
  requestAnimationFrame(frame);
}
