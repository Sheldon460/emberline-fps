// Emberline — bots: 9 bots (4 Ember teammates, 5 Ash defenders) with a
// waypoint-graph brain: patrol routes, hold positions, react to sight and
// sound, plant and defuse, take cover when hurt. Shooting reuses main.js'
// raycast through ctx.shootBot so bot bullets obey the same walls.
import * as THREE from 'three';
import { clamp, collideCircle, rayAABB, segmentBlocked, segmentHitsSphere } from './utils.js';
import { WEAPONS } from './weapons.js';
import { BOUNDS, SITES, WAYPOINTS, findPath, nearestWaypoint } from './map.js';

const EMBER_NAMES = ['Vex', 'Rook', 'Iris', 'Hale'];
const ASH_NAMES = ['Cinder', 'Marrow', 'Sable', 'Onyx', 'Wren'];
const BOT_RADIUS = 0.42;
const EYE = 1.5;

const ROLE_PLANS = {
  ember: [
    { route: [2, 3, 4, 5], hold: 'site' },      // entry -> A
    { route: [2, 3, 8, 9], hold: 'site' },      // entry -> B
    { route: [7, 6, 4, 5], hold: 'flank' },     // lurk west
    { route: [11, 10, 8, 9], hold: 'flank' },   // lurk east
  ],
  ash: [
    { route: [13, 4, 5], hold: 'site' },        // anchor A
    { route: [14, 8, 9], hold: 'site' },        // anchor B
    { route: [3, 2, 1], hold: 'mid' },          // mid
    { route: [13, 3, 14], hold: 'roam' },       // roam north
    { route: [6, 7, 2], hold: 'roam' },         // roam west
  ],
};

export function createBots(ctx) {
  const { S, map, scene, audio } = ctx;
  const bots = S.bots;

  function makeBody(team) {
    const g = new THREE.Group();
    const suit = new THREE.MeshStandardMaterial({ color: team === 'ember' ? 0xc2571a : 0x2f6f6a, roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.8 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.68, 0.3), suit);
    torso.position.y = 1.05;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), skin);
    head.position.y = 1.58;
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.32),
      new THREE.MeshStandardMaterial({ color: team === 'ember' ? 0xf97316 : 0x59b8c4 }));
    band.position.y = 1.68;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.22), dark);
    legL.position.set(-0.14, 0.35, 0);
    const legR = legL.clone();
    legR.position.x = 0.14;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.62), dark);
    gun.position.set(0.2, 1.18, 0.3);
    g.add(torso, head, band, legL, legR, gun);
    g.userData = { torso, head, legL, legR };
    return g;
  }

  function spawnRound() {
    // Remove old bodies.
    for (const b of bots) if (b.group) scene.remove(b.group);
    bots.length = 0;
    const rng = S.rng;
    for (let i = 0; i < 4; i++) {
      bots.push(makeBot('ember', EMBER_NAMES[i], ROLE_PLANS.ember[i], i));
    }
    for (let i = 0; i < 5; i++) {
      bots.push(makeBot('ash', ASH_NAMES[i], ROLE_PLANS.ash[i], i));
    }
    // Bot loadouts: mostly rifles, one sniper, one SMG per team.
    const loadouts = ['vandal', 'vandal', 'longshot', 'whisper'];
    bots.forEach((b, i) => {
      const w = loadouts[i % 4];
      b.weapon = w;
      const def = WEAPONS[w];
      b.mag = def.mag; b.reserve = def.reserve;
      b.kevlar = rng.next() < 0.5;
      // The planter is the first Ember bot; the player carries while alive.
      b.isPlanter = b.team === 'ember' && i === 0;
    });
    for (const b of bots) scene.add(b.group);
  }

  function makeBot(team, name, plan, idx) {
    const spawn = team === 'ember'
      ? { x: (idx - 1.5) * 2.2, z: 17 }
      : { x: (idx - 2) * 2.2, z: -17 };
    const group = makeBody(team);
    group.position.set(spawn.x, 0, spawn.z);
    const bot = {
      id: `${team}-${idx}`, team, name, role: plan.hold,
      hp: 100, alive: true,
      x: spawn.x, z: spawn.z, yaw: team === 'ember' ? 0 : Math.PI,
      weapon: 'vandal', mag: 30, reserve: 90, kevlar: false,
      state: 'move', route: plan.route.slice(), ri: 0,
      holdT: 0, target: null, lastSeenX: 0, lastSeenZ: 0, seenT: 99,
      reactT: 0, burstLeft: 0, burstT: 0, fireCd: 0, reloadT: 0,
      plantT: 0, defuseT: 0, speed: 3.1 + S.rng.range(-0.3, 0.3),
      group, isPlanter: false, walkPhase: S.rng.range(0, 6),
      investigateX: 0, investigateZ: 0, hasInvestigate: false,
    };
    return bot;
  }

  function aliveCount(team) {
    let n = 0;
    for (const b of bots) if (b.team === team && b.alive) n++;
    return n;
  }

  // --- Vision: can this bot see a point? FOV + distance + wall/smoke LOS.
  function canSee(bot, tx, ty, tz) {
    const dx = tx - bot.x, dz = tz - bot.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 46) return false;
    const ang = Math.atan2(-dx, -dz); // yaw convention: forward = (-sin yaw, -cos yaw)
    let diff = ang - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > 1.05 && dist > 4) return false; // ~120 deg FOV
    if (segmentBlocked(bot.x, EYE, bot.z, tx, ty, tz, map.colliders)) return false;
    for (const s of S.smokes) {
      if (segmentHitsSphere(bot.x, EYE, bot.z, tx, ty, tz, s.x, s.y, s.z, s.r)) return false;
    }
    return true;
  }

  function nearestEnemy(bot) {
    // Player first (if Ember's enemy is Ash, the player is a valid target).
    let best = null, bd = Infinity;
    if (bot.team === 'ash' && S.player.alive) {
      if (canSee(bot, S.player.x, 1.4, S.player.z)) {
        const d = Math.hypot(S.player.x - bot.x, S.player.z - bot.z);
        best = { kind: 'player', x: S.player.x, z: S.player.z, d };
        bd = d;
      }
    }
    for (const o of bots) {
      if (!o.alive || o.team === bot.team) continue;
      if (bot.team === 'ember' && o.team === 'ember') continue;
      if (canSee(bot, o.x, 1.4, o.z)) {
        const d = Math.hypot(o.x - bot.x, o.z - bot.z);
        if (d < bd) { bd = d; best = { kind: 'bot', bot: o, x: o.x, z: o.z, d }; }
      }
    }
    return best;
  }

  function routeTo(bot, nodeIdx) {
    const from = nearestWaypoint(bot.x, bot.z);
    bot.route = findPath(from, nodeIdx);
    bot.ri = 0;
    bot.state = 'move';
  }

  function hearShot(x, z, shooterTeam) {
    for (const b of bots) {
      if (!b.alive || b.team === shooterTeam) continue;
      const d = Math.hypot(x - b.x, z - b.z);
      if (d < 26) {
        b.investigateX = x; b.investigateZ = z;
        b.hasInvestigate = true;
        b.seenT = 0; // fresh interest
        if (b.state === 'hold' && b.role !== 'site') {
          routeTo(b, nearestWaypoint(x, z));
        }
      }
    }
  }

  function update(dt) {
    if (S.phase !== 'live' && S.phase !== 'freeze') return;
    for (const bot of bots) {
      if (!bot.alive) continue;
      bot.fireCd -= dt;
      bot.seenT += dt;

      // --- Bomb duties override combat movement ---
      const bomb = S.bomb;
      if (bomb.state === 'planted' && bot.team === 'ash') {
        const site = SITES[bomb.site];
        const d = Math.hypot(site.x - bot.x, site.z - bot.z);
        if (bot.state !== 'defuse') {
          if (d > 3) { if (bot.state !== 'move' || bot.route[bot.route.length - 1] !== (bomb.site === 'A' ? 5 : 9)) routeTo(bot, bomb.site === 'A' ? 5 : 9); }
          else { bot.state = 'defuse'; bot.defuseT = 0; }
        }
      } else if (bomb.state === 'dropped' && bot.team === 'ember') {
        const d = Math.hypot(bomb.x - bot.x, bomb.z - bot.z);
        if (d < 1.2) {
          bomb.state = 'carried'; bomb.carrier = bot.id; bomb.x = bot.x; bomb.z = bot.z;
          bot.isPlanter = true;
          addRadio(`${bot.name} 捡起炸药`);
        } else {
          // The nearest living Ember bot fetches the bomb, even mid-patrol.
          let nearest = null, nd = Infinity;
          for (const o of bots) if (o.team === 'ember' && o.alive) {
            const dd = Math.hypot(bomb.x - o.x, bomb.z - o.z);
            if (dd < nd) { nd = dd; nearest = o; }
          }
          if (nearest === bot) {
            const bombNode = nearestWaypoint(bomb.x, bomb.z);
            if (bot.route[bot.route.length - 1] !== bombNode || bot.state === 'hold') routeTo(bot, bombNode);
          }
        }
      }

      // --- Defuse progress ---
      if (bot.state === 'defuse') {
        const site = SITES[bomb.site];
        const d = Math.hypot(site.x - bot.x, site.z - bot.z);
        if (d > 3.5 || bomb.state !== 'planted') { bot.state = 'move'; bot.defuseT = 0; }
        else {
          bot.defuseT += dt;
          if (Math.floor(bot.defuseT * 2) !== Math.floor((bot.defuseT - dt) * 2)) audio.defuseBeep();
          if (bot.defuseT >= 5) {
            bomb.state = 'defused'; bomb.defuser = bot.id;
            ctx.rounds.endRound('ash', `拆包成功 · ${bot.name}`);
          }
        }
        continue; // defusing bots do not move or shoot
      }

      // --- Plant progress (carrier bot at a site, no enemy close) ---
      if (bomb.state === 'carried' && bomb.carrier === bot.id && bot.team === 'ember') {
        let site = '';
        for (const key of Object.keys(SITES)) {
          const s = SITES[key];
          if ((bot.x - s.x) ** 2 + (bot.z - s.z) ** 2 < s.r * s.r) { site = key; break; }
        }
        const enemyNear = nearestEnemy(bot);
        if (site && !enemyNear) {
          bot.state = 'plant';
          bot.plantT += dt;
          if (Math.floor(bot.plantT * 2) !== Math.floor((bot.plantT - dt) * 2)) audio.plantBeep();
          if (bot.plantT >= 4) {
            bot.plantT = 0; bot.state = 'move';
            ctx.rounds.plantBomb(site, bot.x, bot.z);
          }
          continue;
        }
        if (bot.state === 'plant') bot.state = 'move';
        if (site && bot.state === 'move' && !enemyNear) {
          // already on site: keep planting next frames
        } else if (!site && bot.isPlanter) {
          // walk to the nearer site
          const target = S.rng.next() < 0.5 ? 5 : 9;
          if (bot.route[bot.route.length - 1] !== target) routeTo(bot, target);
        }
      }

      // --- Vision / engagement ---
      const enemy = nearestEnemy(bot);
      if (enemy) {
        bot.target = enemy;
        bot.lastSeenX = enemy.x; bot.lastSeenZ = enemy.z;
        bot.seenT = 0;
        if (bot.reactT <= 0 && bot.burstLeft <= 0) {
          bot.reactT = 0.35 + S.rng.range(0, 0.35);
          bot.burstLeft = 0;
        }
      } else if (bot.seenT > 1.2) {
        bot.target = null;
      }

      if (bot.target) {
        // Face the target and fire in bursts after the reaction delay.
        const tx = bot.target.x, tz = bot.target.z;
        const wantYaw = Math.atan2(-(tx - bot.x), -(tz - bot.z));
        bot.yaw = turnToward(bot.yaw, wantYaw, 6 * dt);
        if (bot.reactT > 0) { bot.reactT -= dt; }
        else if (bot.burstLeft > 0) {
          bot.burstT -= dt;
          if (bot.burstT <= 0 && bot.fireCd <= 0) {
            botShoot(bot, tx, tz);
            bot.burstLeft--;
            bot.burstT = 0.12;
          }
        } else {
          bot.burstLeft = 3 + Math.floor(S.rng.next() * 3);
          bot.burstT = 0;
          bot.fireCd = 0.55 + S.rng.range(0, 0.5);
        }
        // Strafe a little while engaging so fights are not static.
        const strafe = Math.sin(performance.now() / 700 + bot.walkPhase) * 0.6;
        const fx = -Math.sin(bot.yaw), fz = -Math.cos(bot.yaw);
        bot.x += (-fz * strafe) * dt * 0.5;
        bot.z += (fx * strafe) * dt * 0.5;
        collideCircle(bot, BOT_RADIUS, map.colliders);
        bot.x = clamp(bot.x, BOUNDS.x0 + BOT_RADIUS, BOUNDS.x1 - BOT_RADIUS);
        bot.z = clamp(bot.z, BOUNDS.z0 + BOT_RADIUS, BOUNDS.z1 - BOT_RADIUS);
      } else {
        // --- Patrol: follow the route, hold at the end, then loop ---
        if (bot.state === 'move' && bot.route.length) {
          const node = WAYPOINTS[bot.route[bot.ri]];
          const dx = node.x - bot.x, dz = node.z - bot.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.8) {
            bot.ri++;
            if (bot.ri >= bot.route.length) {
              bot.state = 'hold';
              bot.holdT = 1 + S.rng.range(0, 2.5);
              // Loop the patrol route.
              bot.route = bot.route.slice().reverse();
              bot.ri = 0;
            }
          } else {
            const wantYaw = Math.atan2(-dx, -dz);
            bot.yaw = turnToward(bot.yaw, wantYaw, 5 * dt);
            const sp = bot.speed * (S.phase === 'freeze' ? 0 : 1);
            bot.x += (dx / d) * sp * dt;
            bot.z += (dz / d) * sp * dt;
            bot.walkPhase += dt * 9;
          }
          collideCircle(bot, BOT_RADIUS, map.colliders);
          bot.x = clamp(bot.x, BOUNDS.x0 + BOT_RADIUS, BOUNDS.x1 - BOT_RADIUS);
          bot.z = clamp(bot.z, BOUNDS.z0 + BOT_RADIUS, BOUNDS.z1 - BOT_RADIUS);
        } else if (bot.state === 'hold') {
          bot.holdT -= dt;
          // Slow scan while holding.
          bot.yaw += Math.sin(performance.now() / 1600 + bot.walkPhase) * 0.25 * dt;
          if (bot.holdT <= 0) bot.state = 'move';
        } else if (bot.hasInvestigate) {
          routeTo(bot, nearestWaypoint(bot.investigateX, bot.investigateZ));
          bot.hasInvestigate = false;
        }
      }

      // Reload when the mag is dry and nothing is in front of us.
      if (bot.mag <= 0 && bot.reloadT <= 0 && !bot.target) {
        bot.reloadT = WEAPONS[bot.weapon].reloadTime;
        bot.mag = WEAPONS[bot.weapon].mag;
        bot.reserve = Math.max(0, bot.reserve - WEAPONS[bot.weapon].mag);
      }
      if (bot.reloadT > 0) bot.reloadT -= dt;

      // Animate the body.
      const g = bot.group;
      g.position.set(bot.x, 0, bot.z);
      g.rotation.y = bot.yaw + Math.PI; // the model is built facing +z; yaw 0 faces -z
      const sw = Math.sin(bot.walkPhase) * 0.28;
      g.userData.legL.rotation.x = sw;
      g.userData.legR.rotation.x = -sw;
    }

    // Separation: keep bots from stacking on each other.
    for (let i = 0; i < bots.length; i++) {
      const a = bots[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < bots.length; j++) {
        const b = bots[j];
        if (!b.alive) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.64 && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (0.8 - d) / 2;
          const nx = dx / d, nz = dz / d;
          a.x -= nx * push; a.z -= nz * push;
          b.x += nx * push; b.z += nz * push;
        }
      }
    }
  }

  function turnToward(yaw, want, maxStep) {
    let diff = want - yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return yaw + clamp(diff, -maxStep, maxStep);
  }

  function botShoot(bot, tx, tz) {
    const w = WEAPONS[bot.weapon];
    if (bot.mag <= 0) { bot.reloadT = w.reloadTime; bot.mag = w.mag; return; }
    bot.mag--;
    bot.fireCd = w.rate;
    // Spread grows with distance; the ray decides the hit.
    const dist = Math.hypot(tx - bot.x, tz - bot.z);
    const spreadDeg = 1.6 + dist * 0.045 + (bot.target && bot.target.d > 20 ? 1.2 : 0);
    ctx.shootBot(bot, tx, tz, spreadDeg);
    audio.enemyShot(dist);
  }

  function addRadio(text) {
    S.radio.push({ text, ttl: 4 });
    if (S.radio.length > 4) S.radio.shift();
  }

  function killBot(bot, killerName) {
    bot.alive = false;
    bot.hp = 0;
    bot.group.rotation.x = -Math.PI / 2;
    bot.group.position.y = 0.25;
  }

  return { spawnRound, update, aliveCount, hearShot, killBot, canSee };
}
