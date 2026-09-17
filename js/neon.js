/* =========================================================
   neon.js — "Neon Overdrive", a 7-reel cyberpunk slot where each column
   independently shows anywhere from 2 to 5 symbols a spin (same "ways to
   win" idea as Sunset Stampede, just wider and shorter). Two separate
   bonus features instead of one: land 3+ Core symbols anywhere for an
   instant Bonus Wheel spin (3x-500x), or 3+ Glitch symbols anywhere for
   Glitch Spins with an escalating wild multiplier.

   This file is loaded alongside slots.js in the SAME global scope (plain
   scripts, not modules) — every top-level name here is prefixed `neon`/
   `NEON_` on purpose. slots.js's own setMessage()/reelEls/etc used to
   silently collide with ui.js's blackjack code the exact same way before
   that got fixed; this file is written to never repeat that mistake, and
   reuses only the genuinely shared, game-agnostic globals from ui.js
   (account, saveState, refreshWalletHud, beep, sfx*). */

/* ---------------- symbols & paytable ----------------
   pay: [x3, x4, x5, x6, x7] — payout as a multiple of the total bet for
   that symbol (or wild standing in for it) appearing left-to-right
   across 3-7 consecutive reels. */
const NEON_SYMBOLS = {
  diamond:  { key:'diamond',  label:'◆', cls:'neon-shape-diamond',  pay:[0.3, 0.6, 1.5, 4,  10] },
  triangle: { key:'triangle', label:'▲', cls:'neon-shape-triangle', pay:[0.3, 0.6, 1.5, 4,  10] },
  circle:   { key:'circle',   label:'●', cls:'neon-shape-circle',   pay:[0.4, 0.9, 2.2, 6,  15] },
  square:   { key:'square',   label:'■', cls:'neon-shape-square',   pay:[0.4, 0.9, 2.2, 6,  15] },
  sat:      { key:'sat',      label:'🛰️', kind:'icon', pay:[0.7, 1.5, 4,  10, 25] },
  brain:    { key:'brain',    label:'🧠', kind:'icon', pay:[1.2, 3,   8,  20, 50] },
  invader:  { key:'invader',  label:'👾', kind:'icon', pay:[2,   6,   15, 40, 100] },
  mecharm:  { key:'mecharm',  label:'🦾', kind:'icon', pay:[4,   12,  30, 80, 200] },
};
const NEON_WILD = { key:'wild', label:'⚡', pay:[6, 18, 45, 120, 300] };
const NEON_CORE = { key:'core', label:'💠' };
const NEON_GLITCH = { key:'glitch', label:'🌀' };

// Visual rarity tier per icon symbol, matching pay order (sat < brain < invader < mecharm).
const NEON_ICON_TIER = { sat: 'tier-common', brain: 'tier-uncommon', invader: 'tier-rare', mecharm: 'tier-top' };

const NEON_SUPER_WIN_MULT = 40;

const NEON_SYMBOL_WEIGHTS = [
  ['diamond', 18], ['triangle', 18], ['circle', 15], ['square', 15],
  ['sat', 9], ['brain', 7], ['invader', 5], ['mecharm', 3], ['wild', 4],
];
const NEON_WEIGHT_TOTAL = NEON_SYMBOL_WEIGHTS.reduce((s, [, w]) => s + w, 0);
// Each reel independently has a small, mutually-exclusive chance of
// carrying a Core (wheel trigger) or a Glitch (free-spins trigger) instead
// of a normal symbol — never both in the same reel the same spin.
const NEON_CORE_CHANCE = 0.07;
const NEON_GLITCH_CHANCE = 0.07;

function neonRollWeightedSymbol(){
  let r = Math.random() * NEON_WEIGHT_TOTAL;
  for (const [key, w] of NEON_SYMBOL_WEIGHTS){
    r -= w;
    if (r <= 0) return key;
  }
  return NEON_SYMBOL_WEIGHTS[0][0];
}

/* Wild multiplier tables — tuned by Monte Carlo simulation (see the
   scratchpad sim_neon.js used to build this) the same way Sunset
   Stampede's were: free spins mostly resolve to "no bonus" so a whole
   Glitch Spins session averages roughly 20-25x the triggering bet, with a
   long, genuinely rare tail that can occasionally run into the thousands —
   nothing here caps the upside, it's just heavily front-loaded toward
   modest, "pretty random" outcomes instead of being generous every time. */
const NEON_WILD_MULT_TABLE_BASE = [ [2, 50], [3, 25], [5, 15], [10, 10] ];
const NEON_WILD_MULT_TABLE_BONUS = [
  [1, 95.5], [2, 2.8], [3, 0.9], [5, 0.45], [10, 0.2],
  [50, 0.08], [150, 0.02], [600, 0.007], [3000, 0.003],
];
function neonRollWildMultiplier(inBonus){
  if (inBonus){
    const total = NEON_WILD_MULT_TABLE_BONUS.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [mult, w] of NEON_WILD_MULT_TABLE_BONUS){
      r -= w;
      if (r <= 0) return mult > 1 ? mult : null;
    }
    return null;
  }
  if (Math.random() > 0.15) return null;
  const total = NEON_WILD_MULT_TABLE_BASE.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [mult, w] of NEON_WILD_MULT_TABLE_BASE){
    r -= w;
    if (r <= 0) return mult;
  }
  return 2;
}

/* Bonus Wheel prize table — 9 equal visual wedges, weighted picks
   (probabilities sum to 100, NOT proportional to wedge size — same trick
   real "prize wheel" mobile games use). Anchors requested: 3x common
   (30%), 500x the rarest (1%); everything between fills the curve. */
const NEON_WHEEL_TABLE = [
  { mult: 3,   weight: 30 },
  { mult: 5,   weight: 24 },
  { mult: 8,   weight: 16 },
  { mult: 12,  weight: 12 },
  { mult: 20,  weight: 9 },
  { mult: 40,  weight: 5 },
  { mult: 75,  weight: 2 },
  { mult: 150, weight: 1 },
  { mult: 500, weight: 1 },
];
const NEON_WHEEL_COLORS = ['#ff2ec4', '#2ee6ff', '#7c5cff', '#ffdd2e', '#ff6b2e', '#2effa0', '#ff2e6b', '#2e8bff', '#e02eff'];
function neonRollWheelIndex(){
  const total = NEON_WHEEL_TABLE.reduce((s, seg) => s + seg.weight, 0);
  let r = Math.random() * total;
  for (let i = 0; i < NEON_WHEEL_TABLE.length; i++){
    r -= NEON_WHEEL_TABLE[i].weight;
    if (r <= 0) return i;
  }
  return 0;
}

const NEON_BET_LEVELS = Array.from({ length: 10 }, (_, i) => Math.round((i + 1) * 30)); // cents: 30..300
let neonBetIndex = 0;
let neonBusy = false;
let neonInFreeSpins = false;
let neonFreeSpinsRemaining = 0;
let neonFreeSpinsSessionWin = 0;
let neonTurboEnabled = false;

function neonCurrentBetCents(){ return NEON_BET_LEVELS[neonBetIndex]; }

/* ---------------- reel DOM ---------------- */
const NEON_REEL_COUNT = 7;
const NEON_MIN_ROWS = 2;
const NEON_MAX_ROWS = 5;
function neonRandomRowCount(){ return NEON_MIN_ROWS + Math.floor(Math.random() * (NEON_MAX_ROWS - NEON_MIN_ROWS + 1)); }

function neonSymbolData(key){
  if (key === 'wild') return NEON_WILD;
  if (key === 'core') return NEON_CORE;
  if (key === 'glitch') return NEON_GLITCH;
  return NEON_SYMBOLS[key];
}

function neonBuildCellEl(key, wildMult){
  const cell = document.createElement('div');
  cell.className = 'neon-reel-cell';
  const sym = document.createElement('div');
  const data = neonSymbolData(key);
  if (data.cls){
    sym.className = 'neon-reel-symbol neon-shape-badge ' + data.cls;
    sym.textContent = data.label;
  } else if (key === 'wild'){
    sym.className = 'neon-reel-symbol neon-wild-symbol';
    sym.textContent = data.label;
    if (wildMult){
      const badge = document.createElement('span');
      badge.className = 'wild-mult neon-wild-mult';
      badge.textContent = wildMult + '×';
      sym.appendChild(badge);
    }
  } else if (key === 'core'){
    sym.className = 'neon-reel-symbol neon-core-symbol';
    sym.textContent = data.label;
  } else if (key === 'glitch'){
    sym.className = 'neon-reel-symbol neon-glitch-symbol';
    sym.textContent = data.label;
  } else {
    const tierCls = NEON_ICON_TIER[key] || '';
    sym.className = ('neon-reel-symbol neon-icon-symbol ' + tierCls).trim();
    sym.textContent = data.label;
  }
  cell.appendChild(sym);
  return cell;
}

let neonReelEls = []; // { col, mask, strip }
let neonCwPx = 60;
let neonRhPxByCol = [];
let neonFillerCountByCol = [];

function neonInitReels(){
  const window_ = document.getElementById('neon-reel-window');
  if (!window_ || window_.children.length) return;
  const restRows = [];
  for (let c = 0; c < NEON_REEL_COUNT; c++){
    const col = document.createElement('div');
    col.className = 'neon-reel-col';
    const mask = document.createElement('div');
    mask.className = 'neon-reel-mask';
    const strip = document.createElement('div');
    strip.className = 'neon-reel-strip';
    mask.appendChild(strip);
    col.appendChild(mask);
    window_.appendChild(col);
    neonReelEls.push({ col, mask, strip });
    restRows.push(neonRandomRowCount());
  }
  neonSizeReels(restRows);
  neonReelEls.forEach((re, c) => {
    for (let r = 0; r < restRows[c]; r++) re.strip.appendChild(neonBuildCellEl(neonRollWeightedSymbol(), null));
  });
}

function neonSizeReels(colRows){
  const window_ = document.getElementById('neon-reel-window');
  if (!window_) return;
  const PAD = 6, GAP = 4;
  const availW = window_.clientWidth - PAD * 2 - GAP * (NEON_REEL_COUNT - 1);
  const availH = window_.clientHeight - PAD * 2;
  // 7 columns need a lower width cap than Sunset Stampede's 5 to leave
  // room for gaps at narrow widths, but should still widen out nicely on
  // a wide landscape layout instead of leaving gutters either side.
  const cwCap = Math.max(64, Math.min(110, Math.floor(availH / 2.4)));
  neonCwPx = Math.max(24, Math.min(cwCap, Math.floor(availW / NEON_REEL_COUNT)));
  window_.style.setProperty('--ncw', neonCwPx + 'px');
  neonRhPxByCol = colRows.map(rows => Math.max(20, Math.floor(availH / rows)));
  neonReelEls.forEach((re, c) => {
    const rh = neonRhPxByCol[c];
    re.mask.style.setProperty('--nrh', rh + 'px');
    re.mask.style.height = (colRows[c] * rh) + 'px';
  });
}

/* ---------------- spin generation ---------------- */
function neonGenerateSpin(){
  const columns = [];
  const colRows = [];
  const coreCols = [];
  const glitchCols = [];
  const wildMultByCell = {};

  for (let c = 0; c < NEON_REEL_COUNT; c++){
    const rows = neonRandomRowCount();
    colRows.push(rows);
    const hasCore = Math.random() < NEON_CORE_CHANCE;
    const hasGlitch = !hasCore && Math.random() < NEON_GLITCH_CHANCE;
    coreCols.push(hasCore);
    glitchCols.push(hasGlitch);
    const specialRow = (hasCore || hasGlitch) ? Math.floor(Math.random() * rows) : -1;
    const col = [];
    for (let r = 0; r < rows; r++){
      if (r === specialRow){ col.push(hasCore ? 'core' : 'glitch'); continue; }
      const key = neonRollWeightedSymbol();
      col.push(key);
      if (key === 'wild'){
        const mult = neonRollWildMultiplier(neonInFreeSpins);
        if (mult) wildMultByCell[c + ',' + r] = mult;
      }
    }
    columns.push(col);
  }
  return { columns, colRows, coreCols, glitchCols, wildMultByCell };
}

/* ---------------- win evaluation ---------------- */
function neonEvaluateWins(columns, wildMultByCell){
  const wins = [];
  const candidates = [...Object.keys(NEON_SYMBOLS), 'wild'];

  for (const key of candidates){
    let run = 0;
    let bestWildMult = 1;
    const winningCells = [];
    for (let c = 0; c < NEON_REEL_COUNT; c++){
      let matched = false;
      const cellsThisCol = [];
      for (let r = 0; r < columns[c].length; r++){
        const cell = columns[c][r];
        if (cell === key || cell === 'wild'){
          matched = true;
          cellsThisCol.push(r);
          if (cell === 'wild'){
            const m = wildMultByCell[c + ',' + r];
            if (m && m > bestWildMult) bestWildMult = m;
          }
        }
      }
      if (!matched) break;
      cellsThisCol.forEach(r => winningCells.push(c + ',' + r));
      run++;
    }
    if (run >= 3){
      const data = key === 'wild' ? NEON_WILD : NEON_SYMBOLS[key];
      const payMult = data.pay[Math.min(run, 7) - 3];
      const amountCents = Math.round(neonCurrentBetCents() * payMult * bestWildMult);
      wins.push({ key, count: run, amountCents, wildMult: bestWildMult, cells: winningCells });
    }
  }
  return wins;
}

/* ---------------- spin flow ---------------- */
function neonSetSpinBusy(busy){
  neonBusy = busy;
  const btn = document.getElementById('neon-btn-spin');
  const betDown = document.getElementById('neon-bet-step-down');
  const betUp = document.getElementById('neon-bet-step-up');
  if (btn) btn.disabled = busy || (!neonInFreeSpins && Math.round(account.balance * 100) < neonCurrentBetCents());
  if (betDown) betDown.disabled = busy;
  if (betUp) betUp.disabled = busy;
}

function neonSetMessage(text){
  const el = document.getElementById('neon-message');
  if (el) el.textContent = text;
}

function neonFormatCents(cents){
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return sign + '$' + (abs / 100).toFixed(2);
}

function refreshNeonHud(){
  neonInitReels();
  const el = document.getElementById('neon-bet-value');
  if (el) el.textContent = neonFormatCents(neonCurrentBetCents());
  neonSetSpinBusy(neonBusy);
  document.getElementById('neon-free-spins-banner').hidden = !neonInFreeSpins;
  document.getElementById('neon-fs-count').textContent = neonFreeSpinsRemaining;
}

async function neonSpinColumn(c, finalSymbols, wildMultByCell, duration, fast){
  const { strip } = neonReelEls[c];
  const rows = finalSymbols.length;

  strip.innerHTML = '';
  const rowsPerSecond = fast ? 50 : 22;
  const fillerCount = Math.max(fast ? 3 : 6, Math.round((duration / 1000) * rowsPerSecond));
  neonFillerCountByCol[c] = fillerCount;
  for (let i = 0; i < fillerCount; i++) strip.appendChild(neonBuildCellEl(neonRollWeightedSymbol(), null));
  for (let r = 0; r < rows; r++){
    const key = finalSymbols[r];
    const mult = wildMultByCell[c + ',' + r] || null;
    strip.appendChild(neonBuildCellEl(key, mult));
  }

  const travel = fillerCount * neonRhPxByCol[c];
  strip.style.transition = 'none';
  strip.style.transform = 'translateY(0px)';
  // eslint-disable-next-line no-unused-expressions
  strip.offsetHeight;
  strip.style.transition = `transform ${duration}ms cubic-bezier(.2,.7,.25,1)`;
  strip.style.transform = `translateY(-${travel}px)`;

  await new Promise(resolve => setTimeout(resolve, duration));
  beep(500 + c * 15, 0.05, 'square', 0.03);
}

function neonUpdateNearMiss(coreCols, glitchCols, stoppedThrough){
  const specialSoFar = (coreCols.slice(0, stoppedThrough + 1).filter(Boolean).length)
    + (glitchCols.slice(0, stoppedThrough + 1).filter(Boolean).length);
  neonReelEls.forEach(re => re.col.classList.remove('near-miss'));
  if (specialSoFar === 2 && stoppedThrough < NEON_REEL_COUNT - 1){
    for (let c = stoppedThrough + 1; c < NEON_REEL_COUNT; c++) neonReelEls[c].col.classList.add('near-miss');
  }
}

async function neonDoSpin(){
  if (neonBusy) return;
  const betCents = neonCurrentBetCents();
  if (!neonInFreeSpins){
    if (Math.round(account.balance * 100) < betCents){ neonSetMessage("You don't have enough for that bet."); return; }
    account.balance = Math.round((account.balance * 100 - betCents)) / 100;
    saveState(account);
    refreshWalletHud();
  }

  neonSetSpinBusy(true);
  document.getElementById('neon-win-display').hidden = true;
  neonReelEls.forEach(re => {
    re.col.classList.remove('near-miss');
    re.strip.querySelectorAll('.win-glow').forEach(el => el.classList.remove('win-glow'));
  });
  neonSetMessage(neonInFreeSpins ? `Glitch spin — ${neonFreeSpinsRemaining} left` : 'Spinning…');

  const spin = neonGenerateSpin();
  neonSizeReels(spin.colRows);

  const NORMAL_BASE = 480, NORMAL_GAP = 340;
  const TURBO_BASE = 60, TURBO_GAP = 75;
  const stopAt = [];
  const fastFlags = [];
  let cumulative = 0;
  for (let c = 0; c < NEON_REEL_COUNT; c++){
    const specialBefore = spin.coreCols.slice(0, c).filter(Boolean).length + spin.glitchCols.slice(0, c).filter(Boolean).length;
    const nearMissActive = specialBefore === 2;
    const fast = neonTurboEnabled && !nearMissActive;
    fastFlags.push(fast);
    if (c === 0){
      cumulative = fast ? TURBO_BASE : NORMAL_BASE;
    } else {
      cumulative += fast ? TURBO_GAP : NORMAL_GAP;
    }
    stopAt.push(cumulative);
  }

  await Promise.all(neonReelEls.map((re, c) =>
    neonSpinColumn(c, spin.columns[c], spin.wildMultByCell, stopAt[c], fastFlags[c])
      .then(() => neonUpdateNearMiss(spin.coreCols, spin.glitchCols, c))
  ));
  neonReelEls.forEach(re => re.col.classList.remove('near-miss'));

  const wins = neonEvaluateWins(spin.columns, spin.wildMultByCell);
  const totalWinCents = wins.reduce((s, w) => s + w.amountCents, 0);
  const coreCount = spin.coreCols.filter(Boolean).length;
  const glitchCount = spin.glitchCols.filter(Boolean).length;

  if (totalWinCents > 0){
    account.balance = Math.round((account.balance * 100 + totalWinCents)) / 100;
    saveState(account);
    refreshWalletHud();
    if (neonInFreeSpins) neonFreeSpinsSessionWin += totalWinCents;
    neonHighlightWinningTiles(wins);
    document.getElementById('neon-win-amount').textContent = neonFormatCents(totalWinCents);
    document.getElementById('neon-win-display').hidden = false;
    neonSetMessage(neonDescribeWins(wins));
    sfxWin();

    const winMultiple = totalWinCents / betCents;
    if (winMultiple >= NEON_SUPER_WIN_MULT){
      await neonShowSuperWinModal(totalWinCents, winMultiple);
    }
  } else {
    neonSetMessage(neonInFreeSpins ? `Glitch spin — ${neonFreeSpinsRemaining} left` : 'No win this spin — try again!');
  }

  if (coreCount >= 3){
    await neonRunBonusWheel(betCents);
  }
  await neonHandleGlitchOutcome(glitchCount);
  neonSetSpinBusy(false);
}

function neonHighlightWinningTiles(wins){
  const winningCells = new Set();
  wins.forEach(w => w.cells.forEach(ck => winningCells.add(ck)));
  neonReelEls.forEach((re, c) => {
    const filler = neonFillerCountByCol[c] || 0;
    const cellEls = re.strip.children;
    for (let r = 0; filler + r < cellEls.length; r++){
      const symEl = cellEls[filler + r].querySelector('.neon-reel-symbol');
      if (symEl) symEl.classList.toggle('win-glow', winningCells.has(c + ',' + r));
    }
  });
}

function neonDescribeWins(wins){
  const best = wins.slice().sort((a, b) => b.amountCents - a.amountCents)[0];
  const data = best.key === 'wild' ? NEON_WILD : NEON_SYMBOLS[best.key];
  const name = best.key === 'wild' ? 'Surge Wild' : (data.kind === 'icon' ? best.key[0].toUpperCase() + best.key.slice(1) : data.label);
  const multTxt = best.wildMult > 1 ? ` (${best.wildMult}× wild!)` : '';
  return `${best.count}× ${name}${multTxt} — win!`;
}

/* ---------------- Glitch free spins ---------------- */
async function neonHandleGlitchOutcome(glitchCount){
  if (!neonInFreeSpins && glitchCount >= 3){
    neonInFreeSpins = true;
    neonFreeSpinsRemaining = 7;
    neonFreeSpinsSessionWin = 0;
    await neonShowBonusModal('🌀 Glitch Detected!', `You landed ${glitchCount} glitches — 7 Glitch Spins awarded!`, { icon: '🌀' });
  } else if (neonInFreeSpins){
    neonFreeSpinsRemaining -= 1;
    if (glitchCount >= 2){
      neonFreeSpinsRemaining += 4;
      await neonShowBonusModal('🌀 Re-Glitched!', `${glitchCount} glitches in one spin — 4 more Glitch Spins!`, { icon: '🌀' });
    } else if (neonFreeSpinsRemaining <= 0){
      const wonTxt = neonFormatCents(neonFreeSpinsSessionWin);
      neonInFreeSpins = false;
      neonFreeSpinsRemaining = 0;
      await neonShowBonusModal('Glitch Spins Complete!', `You won ${wonTxt} total during your glitch spins.`, { icon: '🏁', celebrate: false });
    }
  }
  refreshNeonHud();
}

function neonShowBonusModal(title, text, opts = {}){
  const { celebrate = true, icon = '🌀' } = opts;
  return new Promise(resolve => {
    document.getElementById('neon-bonus-modal-title').textContent = title;
    document.getElementById('neon-bonus-modal-text').textContent = text;
    document.getElementById('neon-bonus-modal-icon').textContent = icon;
    const modal = document.getElementById('neon-bonus-modal');
    const confettiLayer = document.getElementById('neon-bonus-confetti');
    modal.hidden = false;
    if (celebrate){
      neonSpawnConfetti(confettiLayer);
    } else if (confettiLayer){
      confettiLayer.innerHTML = '';
    }
    sfxAchievement();
    const btn = document.getElementById('neon-btn-bonus-continue');
    const onClick = () => {
      modal.hidden = true;
      btn.removeEventListener('click', onClick);
      resolve();
    };
    btn.addEventListener('click', onClick);
  });
}

const NEON_CONFETTI_COLORS = ['#ff2ec4', '#2ee6ff', '#7c5cff', '#ffdd2e', '#2effa0', '#ff6b2e'];
function neonSpawnConfetti(layerEl, count = 40){
  if (!layerEl) return;
  layerEl.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++){
    const p = document.createElement('span');
    p.className = 'confetti-piece';
    const size = 6 + Math.random() * 6;
    p.style.left = (Math.random() * 100) + '%';
    p.style.width = size + 'px';
    p.style.height = (size * 1.6) + 'px';
    p.style.background = NEON_CONFETTI_COLORS[Math.floor(Math.random() * NEON_CONFETTI_COLORS.length)];
    p.style.animationDuration = (1.5 + Math.random() * 1.3) + 's';
    p.style.animationDelay = (Math.random() * 0.35) + 's';
    p.style.transform = `rotate(${Math.floor(Math.random() * 360)}deg)`;
    frag.appendChild(p);
  }
  layerEl.appendChild(frag);
}

function neonShowSuperWinModal(amountCents, multiple){
  return new Promise(resolve => {
    document.getElementById('neon-superwin-amount').textContent = neonFormatCents(amountCents);
    document.getElementById('neon-superwin-sub').textContent = `${multiple.toFixed(1)}× your bet!`;
    const modal = document.getElementById('neon-superwin-modal');
    modal.hidden = false;
    neonSpawnConfetti(document.getElementById('neon-superwin-confetti'), 60);
    sfxAchievement();
    setTimeout(() => sfxWin(), 200);
    const btn = document.getElementById('neon-btn-superwin-continue');
    const onClick = () => {
      modal.hidden = true;
      btn.removeEventListener('click', onClick);
      resolve();
    };
    btn.addEventListener('click', onClick);
  });
}

/* ---------------- Bonus Wheel ---------------- */
function neonBuildWheelDial(){
  const dial = document.getElementById('neon-wheel-dial');
  if (!dial || dial.children.length) return;
  const n = NEON_WHEEL_TABLE.length;
  const slice = 360 / n;
  const stops = NEON_WHEEL_TABLE.map((seg, i) => {
    const from = (i * slice).toFixed(2), to = ((i + 1) * slice).toFixed(2);
    return `${NEON_WHEEL_COLORS[i % NEON_WHEEL_COLORS.length]} ${from}deg ${to}deg`;
  }).join(', ');
  dial.style.background = `conic-gradient(from 0deg, ${stops})`;
  NEON_WHEEL_TABLE.forEach((seg, i) => {
    const centerAngle = i * slice + slice / 2;
    const segEl = document.createElement('div');
    segEl.className = 'neon-wheel-seg';
    segEl.style.transform = `rotate(${centerAngle}deg)`;
    const label = document.createElement('span');
    label.textContent = seg.mult + '×';
    segEl.appendChild(label);
    dial.appendChild(segEl);
  });
}

let neonWheelRotation = 0;
function neonRunBonusWheel(betCents){
  return new Promise(resolve => {
    neonBuildWheelDial();
    const modal = document.getElementById('neon-wheel-modal');
    const dial = document.getElementById('neon-wheel-dial');
    const spinBtn = document.getElementById('neon-btn-wheel-spin');
    const continueBtn = document.getElementById('neon-btn-wheel-continue');
    const resultEl = document.getElementById('neon-wheel-result');
    const resultMultEl = document.getElementById('neon-wheel-result-mult');
    const resultAmountEl = document.getElementById('neon-wheel-result-amount');
    const subEl = document.getElementById('neon-wheel-sub');

    resultEl.hidden = true;
    continueBtn.hidden = true;
    spinBtn.hidden = false;
    spinBtn.disabled = false;
    subEl.textContent = 'Spin the wheel for an instant multiplier.';
    modal.hidden = false;
    sfxAchievement();

    const onSpin = () => {
      spinBtn.disabled = true;
      spinBtn.removeEventListener('click', onSpin);
      const idx = neonRollWheelIndex();
      const n = NEON_WHEEL_TABLE.length;
      const slice = 360 / n;
      const centerAngle = idx * slice + slice / 2;
      const extraSpins = 6 + Math.floor(Math.random() * 3);
      // The pointer is fixed at the top (0deg); rotate the dial so that
      // segment idx's center ends up there, plus a few extra full turns.
      const target = neonWheelRotation + extraSpins * 360 + (360 - (neonWheelRotation % 360)) + (360 - centerAngle);
      neonWheelRotation = target;
      dial.style.transition = 'transform 4.2s cubic-bezier(.11,.67,.16,1)';
      dial.style.transform = `rotate(${target}deg)`;
      beep(220, 0.05, 'square', 0.02);

      setTimeout(() => {
        const seg = NEON_WHEEL_TABLE[idx];
        const winCents = Math.round(betCents * seg.mult);
        account.balance = Math.round((account.balance * 100 + winCents)) / 100;
        saveState(account);
        refreshWalletHud();
        resultMultEl.textContent = seg.mult + '×';
        resultAmountEl.textContent = neonFormatCents(winCents);
        resultEl.hidden = false;
        spinBtn.hidden = true;
        continueBtn.hidden = false;
        sfxWin();
        setTimeout(() => sfxAchievement(), 150);
        const onContinue = () => {
          modal.hidden = true;
          continueBtn.removeEventListener('click', onContinue);
          resolve();
        };
        continueBtn.addEventListener('click', onContinue);
      }, 4300);
    };
    spinBtn.addEventListener('click', onSpin);
  });
}

/* ---------------- paytable ---------------- */
function neonBuildPaytable(){
  const list = document.getElementById('neon-paytable-list');
  if (!list || list.children.length) return;
  const order = ['mecharm', 'invader', 'brain', 'sat', 'square', 'circle', 'triangle', 'diamond'];
  const rows = [
    { key: 'wild', data: NEON_WILD, note: 'Wild — substitutes for any symbol, rare multiplier (mostly in Glitch Spins)' },
    ...order.map(k => ({ key: k, data: NEON_SYMBOLS[k] })),
    { key: 'core', data: NEON_CORE, note: '3 anywhere = Bonus Wheel (3×-500× instant)' },
    { key: 'glitch', data: NEON_GLITCH, note: '3 anywhere = 7 Glitch Spins · 2+ in a glitch spin = +4 more' },
  ];
  rows.forEach(({ key, data, note }) => {
    const row = document.createElement('div');
    row.className = 'paytable-row neon-paytable-row';
    row.appendChild(neonBuildCellEl(key, key === 'wild' ? 5 : null).firstChild);
    const pays = document.createElement('div');
    pays.className = 'paytable-row-pays';
    if (data.pay){
      pays.innerHTML = `<span>3: <strong>${data.pay[0]}×</strong></span><span>5: <strong>${data.pay[2]}×</strong></span><span>7: <strong>${data.pay[4]}×</strong></span>`;
    } else {
      pays.innerHTML = `<span>${note}</span>`;
      pays.style.fontSize = '.68rem';
    }
    row.appendChild(pays);
    list.appendChild(row);
  });
}

/* ---------------- wiring ---------------- */
document.getElementById('neon-btn-spin').addEventListener('click', neonDoSpin);
document.getElementById('neon-btn-turbo').addEventListener('click', () => {
  neonTurboEnabled = !neonTurboEnabled;
  document.getElementById('neon-btn-turbo').classList.toggle('active', neonTurboEnabled);
  sfxChip();
});
document.getElementById('neon-bet-step-down').addEventListener('click', () => {
  if (neonBetIndex > 0){ neonBetIndex--; refreshNeonHud(); sfxChip(); }
});
document.getElementById('neon-bet-step-up').addEventListener('click', () => {
  if (neonBetIndex < NEON_BET_LEVELS.length - 1){ neonBetIndex++; refreshNeonHud(); sfxChip(); }
});
document.getElementById('neon-btn-paytable').addEventListener('click', () => {
  neonBuildPaytable();
  document.getElementById('neon-paytable-modal').hidden = false;
});
document.getElementById('neon-btn-paytable-close').addEventListener('click', () => {
  document.getElementById('neon-paytable-modal').hidden = true;
});
document.getElementById('neon-paytable-modal').addEventListener('click', e => {
  if (e.target.id === 'neon-paytable-modal') document.getElementById('neon-paytable-modal').hidden = true;
});
