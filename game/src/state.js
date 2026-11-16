// Emberline — state: the single game state store. Every module reads and
// writes this one object; nothing else holds round/match truth.
import { makeRng } from './utils.js';

export const ROUND_TIME = 115; // seconds of live play per round
export const FREEZE_TIME = 3;
export const FUSE_TIME = 40;
export const PLANT_TIME = 4;
export const DEFUSE_TIME = 5;
export const WIN_ROUNDS = 5;

export function createState(seed) {
  return {
    seed,
    rng: makeRng(seed),
    phase: 'lobby', // lobby | freeze | live | roundEnd | matchEnd
    phaseT: 0,
    round: 1,
    score: { ember: 0, ash: 0 },
    timer: ROUND_TIME,
    freezeT: FREEZE_TIME,
    roundReason: '',
    roundWinner: '',
    matchWinner: '',
    lossStreak: 0, // consecutive round losses for Ember (economy)
    // The player is always Ember, always the bomb carrier while alive.
    player: {
      hp: 100, alive: true,
      x: 0, z: 16, yaw: 0, pitch: 0,
      crouched: false, ads: false, moving: false, sprinting: false,
      weapon: 'p9', mag: 12, reserve: 48,
      money: 800, kevlar: false,
      grenades: { frag: 0, smoke: 0 },
      spread: 0, recoil: 0, bloom: 0,
      reloading: false, reloadT: 0,
      planting: false, plantT: 0,
      kills: 0, deaths: 0, damage: 0,
      vy: 0, grounded: true,
    },
    bots: [], // filled by bots.js
    bomb: {
      state: 'carried', // carried | dropped | planting | planted | defusing | detonated | defused
      site: '', carrier: 'player', // 'player' or a bot id
      x: 0, z: 16, plantT: 0, fuseT: FUSE_TIME, defuseT: 0, defuser: '',
    },
    grenades: [], // live projectiles {x,y,z,vx,vy,vz,kind,fuse}
    smokes: [], // active smoke clouds {x,y,z,r,ttl}
    tracers: [], // render-only {x1,y1,z1,x2,y2,z2,ttl}
    killfeed: [], // {text, kind, ttl}
    radio: [], // bot callouts {text, ttl}
    hits: [], // damage numbers {x,y,z,text,ttl,crit}
    shotsFired: 0,
    roundKills: { ember: 0, ash: 0 },
  };
}

// Wipe per-round transient state. Money and score survive.
export function resetRoundState(S) {
  S.timer = ROUND_TIME;
  S.freezeT = FREEZE_TIME;
  S.roundReason = '';
  S.roundWinner = '';
  S.grenades.length = 0;
  S.smokes.length = 0;
  S.tracers.length = 0;
  S.hits.length = 0;
  S.radio.length = 0;
  S.roundKills.ember = 0;
  S.roundKills.ash = 0;
  S.bomb.state = 'carried';
  S.bomb.site = '';
  S.bomb.carrier = 'player';
  S.bomb.plantT = 0;
  S.bomb.fuseT = FUSE_TIME;
  S.bomb.defuseT = 0;
  S.bomb.defuser = '';
}
