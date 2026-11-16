// Emberline — HUD: health/ammo/timer/score/money, killfeed, bomb status,
// crosshair with dynamic spread, hitmarker, minimap, buy menu, banners.
import * as THREE from 'three';
import { WEAPONS, BUY_LIST, GRENADE_PRICE, KEVLAR_PRICE } from './weapons.js';
import { SITES } from './map.js';
import { segmentBlocked, clamp } from './utils.js';

const $ = (id) => document.getElementById(id);

export function createHud(ctx) {
  const { S, map } = ctx;
  const el = {
    healthBar: $('health-bar'), healthNum: $('health-num'),
    ammoMag: $('ammo-mag'), ammoRes: $('ammo-res'),
    timer: $('timer'), scoreE: $('score-ember'), scoreA: $('score-ash'),
    money: $('money'), roundLabel: $('round-label'),
    pipsE: $('pips-ember'), pipsA: $('pips-ash'),
    killfeed: $('killfeed'), radio: $('radio'),
    bombStatus: $('bomb-status'), crosshair: $('crosshair'),
    hitmarker: $('hitmarker'), dmgLayer: $('dmg-layer'),
    minimap: $('minimap'), buyMenu: $('buy-menu'), buyList: $('buy-list'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    overlayStart: $('overlay-start'), overlayPause: $('overlay-pause'),
    overlayEnd: $('overlay-end'), endTitle: $('end-title'), endSub: $('end-sub'),
    plantBar: $('plant-bar'), plantFill: $('plant-fill'),
    weaponName: $('weapon-name'), grenades: $('grenades'),
    hint: $('hint'), kevlar: $('kevlar'),
  };
  const mm = el.minimap.getContext('2d');
  const projV = new THREE.Vector3();
  let buyVisible = false;
  let lastTimer = '';
  let lastHp = -1;
  let hitT = 0;

  function showHitmarker(crit) {
    el.hitmarker.classList.remove('crit');
    if (crit) el.hitmarker.classList.add('crit');
    el.hitmarker.style.opacity = '1';
    hitT = 0.18;
  }

  function setBuyVisible(v) {
    buyVisible = v;
    el.buyMenu.classList.toggle('hidden', !v);
    if (v) renderBuy();
  }
  function isBuyVisible() { return buyVisible; }

  function renderBuy() {
    const P = S.player;
    let html = '';
    for (const item of BUY_LIST) {
      let price, owned = false, label = item.label;
      if (item.id === 'kevlar') { price = KEVLAR_PRICE; owned = P.kevlar; }
      else if (item.id === 'frag' || item.id === 'smoke') { price = GRENADE_PRICE[item.id]; label += ` ×${P.grenades[item.id]}`; }
      else { price = WEAPONS[item.id].price; owned = P.weapon === item.id; }
      const afford = P.money >= price;
      html += `<div class="buy-item ${owned ? 'owned' : ''} ${afford ? '' : 'poor'}"><span class="buy-key">${item.key}</span><span class="buy-label">${label}</span><span class="buy-price">$${price}</span></div>`;
    }
    el.buyList.innerHTML = html;
  }

  function drawMinimap(camera) {
    const W = el.minimap.width, H = el.minimap.height;
    const sx = W / 64, sz = H / 44;
    const X = (x) => (x + 32) * sx;
    const Z = (z) => (z + 22) * sz;
    mm.clearRect(0, 0, W, H);
    mm.fillStyle = 'rgba(20,24,30,0.85)';
    mm.fillRect(0, 0, W, H);
    mm.fillStyle = '#3a3f47';
    for (const c of map.colliders) {
      if (c.y1 < 0.9) continue;
      mm.fillRect(X(c.x0), Z(c.z0), (c.x1 - c.x0) * sx, (c.z1 - c.z0) * sz);
    }
    for (const key of Object.keys(SITES)) {
      const s = SITES[key];
      mm.strokeStyle = '#ffb347';
      mm.beginPath();
      mm.arc(X(s.x), Z(s.z), s.r * sx, 0, Math.PI * 2);
      mm.stroke();
      mm.fillStyle = '#ffb347';
      mm.font = 'bold 11px sans-serif';
      mm.fillText(key, X(s.x) - 3, Z(s.z) + 4);
    }
    // Bomb marker.
    const bomb = S.bomb;
    if (bomb.state === 'planted' || bomb.state === 'dropped') {
      mm.fillStyle = '#ff3b30';
      mm.beginPath();
      mm.arc(X(bomb.x), Z(bomb.z), 4, 0, Math.PI * 2);
      mm.fill();
    }
    // Teammates.
    for (const b of S.bots) {
      if (!b.alive) continue;
      mm.fillStyle = b.team === 'ember' ? '#f97316' : '#59b8c4';
      mm.beginPath();
      mm.arc(X(b.x), Z(b.z), 3, 0, Math.PI * 2);
      mm.fill();
    }
    // Enemies only when the player can actually see them.
    const P = S.player;
    if (P.alive) {
      for (const b of S.bots) {
        if (!b.alive || b.team !== 'ash') continue;
        if (!segmentBlocked(P.x, 1.5, P.z, b.x, 1.4, b.z, map.colliders)) {
          mm.fillStyle = '#ff3b30';
          mm.beginPath();
          mm.arc(X(b.x), Z(b.z), 3.5, 0, Math.PI * 2);
          mm.fill();
        }
      }
    }
    // Player arrow.
    const px = X(P.x), pz = Z(P.z);
    mm.save();
    mm.translate(px, pz);
    mm.rotate(Math.atan2(-Math.sin(P.yaw), -Math.cos(P.yaw)) + Math.PI / 2);
    mm.fillStyle = '#ffffff';
    mm.beginPath();
    mm.moveTo(0, -6); mm.lineTo(4, 5); mm.lineTo(-4, 5); mm.closePath();
    mm.fill();
    mm.restore();
  }

  function update(dt, camera) {
    const P = S.player;
    // Health.
    if (P.hp !== lastHp) {
      lastHp = P.hp;
      el.healthNum.textContent = Math.max(0, Math.ceil(P.hp));
      el.healthBar.style.width = `${clamp(P.hp, 0, 100)}%`;
      el.healthBar.style.background = P.hp > 50 ? '#f97316' : P.hp > 25 ? '#ffb347' : '#ff3b30';
    }
    // Ammo / weapon.
    const w = WEAPONS[P.weapon];
    el.ammoMag.textContent = P.reloading ? '--' : P.mag;
    el.ammoRes.textContent = P.reserve;
    el.weaponName.textContent = w.name + (P.reloading ? ' · 换弹中' : '');
    el.grenades.textContent = `手雷 ${P.grenades.frag} · 烟雾 ${P.grenades.smoke}`;
    el.kevlar.style.display = P.kevlar ? 'inline' : 'none';
    // Timer.
    const t = S.bomb.state === 'planted'
      ? `引信 ${Math.max(0, Math.ceil(S.bomb.fuseT))}`
      : S.phase === 'freeze' ? `冻结 ${Math.ceil(S.phaseT)}` : fmtTime(S.timer);
    if (t !== lastTimer) { lastTimer = t; el.timer.textContent = t; }
    el.scoreE.textContent = S.score.ember;
    el.scoreA.textContent = S.score.ash;
    el.money.textContent = `$${P.money}`;
    el.roundLabel.textContent = `第 ${S.round} 回合 · 先胜 ${5} 局`;
    // Alive pips.
    el.pipsE.textContent = '●'.repeat(ctx.bots.aliveCount('ember') + (P.alive ? 1 : 0)) + '○'.repeat(5 - (ctx.bots.aliveCount('ember') + (P.alive ? 1 : 0)));
    el.pipsA.textContent = '●'.repeat(ctx.bots.aliveCount('ash')) + '○'.repeat(5 - ctx.bots.aliveCount('ash'));
    // Crosshair gap from spread + bloom.
    const spreadDeg = (w.spread + (P.moving ? w.moveSpread : 0) + P.bloom * 2.2) * (P.ads ? 0.4 : 1);
    const gap = 5 + spreadDeg * 7;
    el.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    el.crosshair.style.opacity = P.alive && S.phase !== 'lobby' ? '1' : '0';
    // Hitmarker fade.
    if (hitT > 0) { hitT -= dt; if (hitT <= 0) el.hitmarker.style.opacity = '0'; }
    // Killfeed.
    for (const f of S.killfeed) f.ttl -= dt;
    S.killfeed = S.killfeed.filter((f) => f.ttl > 0);
    el.killfeed.innerHTML = S.killfeed.map((f) => `<div class="feed-${f.kind}">${f.text}</div>`).join('');
    for (const r of S.radio) r.ttl -= dt;
    S.radio = S.radio.filter((r) => r.ttl > 0);
    el.radio.innerHTML = S.radio.map((r) => `<div>📻 ${r.text}</div>`).join('');
    // Bomb status line.
    const bomb = S.bomb;
    el.bombStatus.textContent =
      bomb.state === 'planted' ? `⚠ 炸药已安放 ${SITES[bomb.site].name} · ${Math.ceil(bomb.fuseT)}s`
      : bomb.state === 'dropped' ? '⚠ 炸药掉落 · 队友正在回收'
      : bomb.state === 'carried' && bomb.carrier === 'player' ? '🎒 你携带炸药 · 在 A 或 B 按住 E 安放'
      : bomb.state === 'carried' ? '🎒 队友携带炸药'
      : '';
    // Plant progress.
    if (P.planting) {
      el.plantBar.classList.remove('hidden');
      el.plantFill.style.width = `${(P.plantT / 4) * 100}%`;
    } else el.plantBar.classList.add('hidden');
    // Banner.
    if (S.phase === 'roundEnd') {
      el.banner.classList.remove('hidden');
      el.bannerTitle.textContent = S.roundWinner === 'ember' ? '回合胜利' : '回合失利';
      el.bannerTitle.style.color = S.roundWinner === 'ember' ? '#f97316' : '#ff3b30';
      el.bannerSub.textContent = S.roundReason;
    } else el.banner.classList.add('hidden');
    // Damage numbers: project world -> screen.
    for (const h of S.hits) h.ttl -= dt;
    S.hits = S.hits.filter((h) => h.ttl > 0);
    let dmgHtml = '';
    for (const h of S.hits) {
      projV.set(h.x, h.y, h.z).project(camera);
      if (projV.z > 1) continue;
      const sx = (projV.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-projV.y * 0.5 + 0.5) * window.innerHeight;
      dmgHtml += `<div class="dmg ${h.crit ? 'crit' : ''}" style="left:${sx.toFixed(0)}px;top:${(sy - (1 - h.ttl) * 40).toFixed(0)}px">${h.text}</div>`;
    }
    el.dmgLayer.innerHTML = dmgHtml;
    // Buy menu refresh while open.
    if (buyVisible) renderBuy();
    // Overlays.
    el.overlayStart.classList.toggle('hidden', S.phase !== 'lobby');
    el.overlayPause.classList.toggle('hidden', !(S.phase !== 'lobby' && S.phase !== 'matchEnd' && !ctx.input.locked && !window.__shotMode));
    el.overlayEnd.classList.toggle('hidden', S.phase !== 'matchEnd');
    if (S.phase === 'matchEnd') {
      el.endTitle.textContent = S.matchWinner === 'ember' ? 'Emberline · 胜利' : 'Ash 获胜';
      el.endSub.textContent = `比分 ${S.score.ember} : ${S.score.ash} · 击杀 ${P.kills} · 死亡 ${P.deaths}`;
    }
    el.hint.textContent = S.phase === 'live'
      ? 'WASD 移动 · Shift 疾跑 · C 蹲 · 右键机瞄 · R 换弹 · B 商店 · G 手雷 · H 烟雾 · E 安包'
      : '';
    drawMinimap(camera);
  }

  function fmtTime(t) {
    const m = Math.floor(Math.max(0, t) / 60);
    const s = Math.floor(Math.max(0, t) % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  return { update, showHitmarker, setBuyVisible, isBuyVisible, renderBuy };
}
