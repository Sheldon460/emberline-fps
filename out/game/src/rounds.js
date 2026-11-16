// Emberline — rounds: round lifecycle, win conditions, economy and the
// buy menu. The single place where scores, money and phase change.
import { WEAPONS, GRENADE_PRICE, KEVLAR_PRICE } from './weapons.js';
import { ROUND_TIME, FREEZE_TIME, FUSE_TIME, WIN_ROUNDS, resetRoundState } from './state.js';
import { SITES } from './map.js';

export function createRounds(ctx) {
  const { S, audio } = ctx;

  function startMatch() {
    S.score.ember = 0;
    S.score.ash = 0;
    S.round = 1;
    S.lossStreak = 0;
    S.player.money = 800;
    S.player.weapon = 'p9';
    S.player.mag = WEAPONS.p9.mag;
    S.player.reserve = WEAPONS.p9.reserve;
    S.player.kevlar = false;
    S.player.grenades = { frag: 0, smoke: 0 };
    S.player.kills = 0;
    S.player.deaths = 0;
    startRound();
  }

  function startRound() {
    resetRoundState(S);
    const P = S.player;
    P.hp = 100;
    P.alive = true;
    P.x = 0; P.z = 17;
    P.yaw = 0; P.pitch = 0;
    P.reloading = false;
    P.planting = false; P.plantT = 0;
    P.bloom = 0; P.recoil = 0;
    ctx.bots.spawnRound();
    S.phase = 'freeze';
    S.phaseT = FREEZE_TIME;
    S.timer = ROUND_TIME;
    addFeed(`第 ${S.round} 回合 · 购买阶段 (B 打开商店)`, 'sys');
  }

  function update(dt) {
    if (S.phase === 'freeze') {
      S.phaseT -= dt;
      if (S.phaseT <= 0) {
        S.phase = 'live';
        addFeed('回合开始', 'sys');
      }
      return;
    }
    if (S.phase !== 'live') return;

    // Round timer: defenders win on time only while the bomb is not planted.
    if (S.bomb.state !== 'planted') {
      S.timer -= dt;
      if (S.timer <= 0) {
        endRound('ash', '时间耗尽 · 未安包');
        return;
      }
    } else {
      S.bomb.fuseT -= dt;
      if (S.bomb.fuseT <= 0) {
        S.bomb.state = 'detonated';
        endRound('ember', '炸药引爆');
        return;
      }
    }

    // Elimination check.
    const emberAlive = (S.player.alive ? 1 : 0) + ctx.bots.aliveCount('ember');
    const ashAlive = ctx.bots.aliveCount('ash');
    if (ashAlive === 0) { endRound('ember', '全歼 Ash'); return; }
    if (emberAlive === 0) {
      endRound(S.bomb.state === 'planted' ? 'ember' : 'ash',
        S.bomb.state === 'planted' ? 'Ember 全灭 · 但炸药已安放' : 'Ember 全灭');
    }
  }

  function endRound(winner, reason) {
    if (S.phase !== 'live' && S.phase !== 'freeze') return;
    S.phase = 'roundEnd';
    S.phaseT = 4;
    S.roundWinner = winner;
    S.roundReason = reason;
    S.score[winner]++;
    const P = S.player;
    if (winner === 'ember') {
      P.money += 3250;
      S.lossStreak = 0;
      audio.roundWin();
    } else {
      P.money += 1900 + Math.min(S.lossStreak, 3) * 500;
      S.lossStreak++;
      audio.roundLose();
    }
    addFeed(`${winner === 'ember' ? 'Ember' : 'Ash'} 赢下回合 · ${reason}`, winner);
  }

  function afterRoundEnd(dt) {
    if (S.phase !== 'roundEnd') return;
    S.phaseT -= dt;
    if (S.phaseT > 0) return;
    if (S.score.ember >= WIN_ROUNDS || S.score.ash >= WIN_ROUNDS) {
      S.phase = 'matchEnd';
      S.matchWinner = S.score.ember >= WIN_ROUNDS ? 'ember' : 'ash';
      return;
    }
    S.round++;
    startRound();
  }

  function plantBomb(site, x, z) {
    const bomb = S.bomb;
    bomb.state = 'planted';
    bomb.site = site;
    bomb.x = x; bomb.z = z;
    bomb.fuseT = FUSE_TIME;
    bomb.defuseT = 0;
    audio.plantDone();
    addFeed(`炸药已在 ${SITES[site].name} 安放 · ${FUSE_TIME}s 引信`, 'ember');
    S.radio.push({ text: '炸药已安放，守住包点！', ttl: 4 });
  }

  function onPlayerDeath() {
    const P = S.player;
    P.deaths++;
    P.alive = false;
    const bomb = S.bomb;
    if (bomb.state === 'carried' && bomb.carrier === 'player') {
      bomb.state = 'dropped';
      bomb.carrier = '';
      bomb.x = P.x; bomb.z = P.z;
      addFeed('炸药掉落', 'sys');
    }
  }

  function buy(id) {
    const P = S.player;
    if (S.phase !== 'freeze' && !(S.phase === 'live' && S.timer > ROUND_TIME - 10)) {
      addFeed('购买时间已过', 'sys');
      return false;
    }
    if (id === 'kevlar') {
      if (P.kevlar) return false;
      if (P.money < KEVLAR_PRICE) return false;
      P.money -= KEVLAR_PRICE;
      P.kevlar = true;
    } else if (id === 'frag' || id === 'smoke') {
      if (P.money < GRENADE_PRICE[id]) return false;
      P.money -= GRENADE_PRICE[id];
      P.grenades[id]++;
    } else {
      const w = WEAPONS[id];
      if (!w || P.weapon === id) return false;
      if (P.money < w.price) return false;
      P.money -= w.price;
      P.weapon = id;
      P.mag = w.mag;
      P.reserve = w.reserve;
      P.reloading = false;
    }
    audio.buy();
    return true;
  }

  function addFeed(text, kind) {
    S.killfeed.push({ text, kind, ttl: 5 });
    if (S.killfeed.length > 6) S.killfeed.shift();
  }

  return { startMatch, startRound, update, afterRoundEnd, endRound, plantBomb, onPlayerDeath, buy, addFeed };
}
