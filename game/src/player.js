// Emberline — player: FPS movement (acceleration, friction, crouch,
// collision), look, reload, bomb planting and grenade throws.
// Combat resolution (raycast, damage) lives in main.js via ctx.shoot.
import { clamp, collideCircle } from './utils.js';
import { WEAPONS } from './weapons.js';
import { BOUNDS, SITES } from './map.js';

const EYE_STAND = 1.62;
const EYE_CROUCH = 1.05;
const RADIUS = 0.42;

export function createPlayer(ctx) {
  const { S, input, map, audio } = ctx;
  const P = S.player;
  let eyeH = EYE_STAND;
  let vx = 0, vz = 0;
  let fireCd = 0;
  let stepT = 0;

  function speedFor() {
    if (P.crouched) return 2.0;
    if (P.ads) return 2.4;
    if (P.sprinting) return 6.0;
    return 4.2;
  }

  function update(dt) {
    const k = input.keys;
    const [mdx, mdy] = input.consumeMouse();
    const sens = P.ads ? 0.0013 : 0.0022;
    P.yaw -= mdx * sens;
    P.pitch = clamp(P.pitch - mdy * sens, -1.5, 1.5);

    P.crouched = !!(k.KeyC || k.ControlLeft);
    P.ads = input.adsHeld && !P.crouched;
    P.sprinting = !!(k.ShiftLeft || k.ShiftRight) && !P.ads && !P.crouched;

    // Wish direction from keys, rotated by yaw.
    let fx = 0, fz = 0;
    if (k.KeyW || k.ArrowUp) fz -= 1;
    if (k.KeyS || k.ArrowDown) fz += 1;
    if (k.KeyA || k.ArrowLeft) fx -= 1;
    if (k.KeyD || k.ArrowRight) fx += 1;
    const len = Math.hypot(fx, fz) || 1;
    fx /= len; fz /= len;
    const sin = Math.sin(P.yaw), cos = Math.cos(P.yaw);
    // Camera forward is (-sin, -cos) for yaw about Y.
    const wx = fx * cos - fz * sin;
    const wz = fx * sin + fz * cos;
    P.moving = (fx !== 0 || fz !== 0);

    const speed = speedFor();
    const accel = P.moving ? 14 : 11;
    vx += (wx * speed - vx) * Math.min(1, accel * dt);
    vz += (wz * speed - vz) * Math.min(1, accel * dt);
    P.x = clamp(P.x + vx * dt, BOUNDS.x0 + RADIUS, BOUNDS.x1 - RADIUS);
    P.z = clamp(P.z + vz * dt, BOUNDS.z0 + RADIUS, BOUNDS.z1 - RADIUS);
    collideCircle(P, RADIUS, map.colliders);

    // Footsteps.
    stepT -= dt * Math.hypot(vx, vz);
    if (stepT <= 0 && P.moving) { audio.step(); stepT = 2.2; }

    // Eye height eases between stand and crouch.
    const targetEye = P.crouched ? EYE_CROUCH : EYE_STAND;
    eyeH += (targetEye - eyeH) * Math.min(1, 12 * dt);

    // Bloom and recoil decay; spread follows stance.
    P.bloom = Math.max(0, P.bloom - 2.4 * dt);
    P.recoil = Math.max(0, P.recoil - 0.09 * dt);

    // Reload.
    if (P.reloading) {
      P.reloadT -= dt;
      if (P.reloadT <= 0) {
        P.reloading = false;
        const w = WEAPONS[P.weapon];
        const need = w.mag - P.mag;
        const take = Math.min(need, P.reserve);
        P.mag += take; P.reserve -= take;
      }
    }

    // Fire cooldown.
    fireCd -= dt;

    const pressed = input.consumePressed();
    if (pressed.KeyR) startReload();
    if (pressed.KeyG) throwGrenade('frag');
    if (pressed.KeyH) throwGrenade('smoke');

    // Bomb planting: hold E while the carrier stands on a site.
    updatePlant(dt, k.KeyE === true);

    return { eyeH, fireCd };
  }

  function startReload() {
    const w = WEAPONS[P.weapon];
    if (P.reloading || P.mag >= w.mag || P.reserve <= 0) return;
    P.reloading = true;
    P.reloadT = w.reloadTime;
    audio.reload();
  }

  function updatePlant(dt, holdingE) {
    const bomb = S.bomb;
    if (bomb.state !== 'carried' || bomb.carrier !== 'player' || !P.alive) { P.planting = false; P.plantT = 0; return; }
    let site = '';
    for (const key of Object.keys(SITES)) {
      const s = SITES[key];
      const dx = P.x - s.x, dz = P.z - s.z;
      if (dx * dx + dz * dz < s.r * s.r) { site = key; break; }
    }
    if (!site) { P.planting = false; P.plantT = 0; return; }
    if (holdingE && S.phase === 'live') {
      P.planting = true;
      P.plantT += dt;
      if (Math.floor(P.plantT * 2) !== Math.floor((P.plantT - dt) * 2)) audio.plantBeep();
      if (P.plantT >= 4) {
        P.planting = false; P.plantT = 0;
        ctx.rounds.plantBomb(site, P.x, P.z);
      }
    } else {
      P.planting = false; P.plantT = 0;
    }
  }

  function throwGrenade(kind) {
    if (!P.alive || S.phase !== 'live') return;
    if ((P.grenades[kind] || 0) <= 0) return;
    P.grenades[kind]--;
    const dir = cameraDir();
    S.grenades.push({
      kind,
      x: P.x, y: eyeH, z: P.z,
      vx: dir.x * 15, vy: dir.y * 15 + 4.5, vz: dir.z * 15,
      fuse: kind === 'frag' ? 1.4 : 0.9,
    });
    audio.reload();
  }

  function cameraDir() {
    const cp = Math.cos(P.pitch), sp = Math.sin(P.pitch);
    return { x: -Math.sin(P.yaw) * cp, y: sp, z: -Math.cos(P.yaw) * cp };
  }

  function eyePos(out) {
    out.x = P.x; out.y = eyeH; out.z = P.z;
    return out;
  }

  // Called by main.js when the trigger is held and the cooldown allows it.
  // Returns true when a shot was actually fired.
  function tryFire() {
    if (!P.alive || S.phase !== 'live' || P.reloading) return false;
    if (fireCd > 0) return false;
    const w = WEAPONS[P.weapon];
    if (P.mag <= 0) {
      audio.dryFire();
      fireCd = 0.3;
      startReload();
      return false;
    }
    fireCd = w.rate;
    P.mag--;
    P.bloom = Math.min(1, P.bloom + w.recoil * 2.2);
    P.recoil = Math.min(0.12, P.recoil + w.recoil);
    P.pitch = clamp(P.pitch + w.recoil * 0.55, -1.5, 1.5);
    return true;
  }

  function fireCooldown() { return fireCd; }

  return { update, tryFire, fireCooldown, eyePos, cameraDir, startReload, speedFor };
}
