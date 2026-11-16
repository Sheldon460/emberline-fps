// Emberline — weapons: defs, fire/reload/spread/recoil, grenades.
// Damage is applied by raycast in main.js; this module owns the numbers.
export const WEAPONS = {
  p9: {
    name: 'P9', kind: 'pistol', price: 0, auto: false,
    damage: 26, headMult: 4, rate: 0.28, mag: 12, reserve: 48,
    spread: 0.9, moveSpread: 1.6, adsSpread: 0.35, recoil: 0.011, reloadTime: 1.4, range: 60,
  },
  vandal: {
    name: 'Vandal-9', kind: 'rifle', price: 2900, auto: true,
    damage: 34, headMult: 4, rate: 0.105, mag: 30, reserve: 90,
    spread: 1.1, moveSpread: 2.2, adsSpread: 0.4, recoil: 0.016, reloadTime: 2.1, range: 70,
  },
  whisper: {
    name: 'Whisper SMG', kind: 'smg', price: 1500, auto: true,
    damage: 22, headMult: 4, rate: 0.072, mag: 32, reserve: 96,
    spread: 1.5, moveSpread: 2.6, adsSpread: 0.7, recoil: 0.009, reloadTime: 1.8, range: 45,
  },
  scatter: {
    name: 'Scatter-12', kind: 'shotgun', price: 1800, auto: false,
    damage: 12, headMult: 3, rate: 0.85, mag: 6, reserve: 24,
    spread: 4.2, moveSpread: 5.5, adsSpread: 3.4, recoil: 0.045, reloadTime: 2.6, range: 30,
    pellets: 8,
  },
  longshot: {
    name: 'Longshot DMR', kind: 'sniper', price: 4000, auto: false,
    damage: 88, headMult: 4, rate: 0.9, mag: 5, reserve: 20,
    spread: 0.25, moveSpread: 3.2, adsSpread: 0.08, recoil: 0.05, reloadTime: 2.8, range: 90,
  },
};

export const GRENADE_PRICE = { frag: 300, smoke: 300 };
export const KEVLAR_PRICE = 650;

export const BUY_LIST = [
  { key: '1', id: 'vandal', label: 'Vandal-9 步枪' },
  { key: '2', id: 'whisper', label: 'Whisper 冲锋枪' },
  { key: '3', id: 'scatter', label: 'Scatter-12 霰弹枪' },
  { key: '4', id: 'longshot', label: 'Longshot 射手步枪' },
  { key: '5', id: 'kevlar', label: 'Kevlar 防弹衣' },
  { key: '6', id: 'frag', label: '破片手雷' },
  { key: '7', id: 'smoke', label: '烟雾弹' },
];

// Effective spread in degrees for one shot, from stance and motion.
export function shotSpread(w, shooter) {
  let s = w.spread;
  if (shooter.moving) s += w.moveSpread;
  if (shooter.crouched) s *= 0.55;
  if (shooter.ads) s = w.adsSpread + (shooter.moving ? w.moveSpread * 0.3 : 0);
  // Bloom: sustained fire opens the cone up.
  s += (shooter.bloom || 0) * 2.2;
  return s;
}

// Grenade physics: one step of a thrown grenade. Mutates g in place.
export function stepGrenade(g, dt) {
  g.vy -= 22 * dt;
  g.x += g.vx * dt;
  g.y += g.vy * dt;
  g.z += g.vz * dt;
  if (g.y < 0.15) {
    g.y = 0.15;
    g.vy = -g.vy * 0.35;
    g.vx *= 0.6; g.vz *= 0.6;
    if (Math.abs(g.vy) < 1.2) g.vy = 0;
  }
  g.fuse -= dt;
}
