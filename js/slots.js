/* =========================================================
   slots.js — "Sunset Stampede", a 5-reel wildlife slot where each
   column independently shows anywhere from 2 to 7 symbols a spin (a
   "ways to win" layout, not a fixed grid). Original theme/art (not the
   trademarked commercial machine the feature was inspired by) built
   from the same emoji/CSS-medallion toolkit as the blackjack cards,
   wired into the shared account (account.balance) so wins/losses carry
   over everywhere else.
   ========================================================= */

/* ---------------- symbols & paytable ----------------
   pay: [x3, x4, x5] — payout as a multiple of the total bet for that
   symbol (or wild standing in for it) appearing left-to-right across
   3, 4 or 5 consecutive reels. Higher tier = rarer + bigger payout. */
const SLOT_SYMBOLS = {
  nine:  { key:'nine',  label:'9',  kind:'rank', cls:'rank-nine',  pay:[0.4, 1,   3] },
  ten:   { key:'ten',   label:'10', kind:'rank', cls:'rank-ten',   pay:[0.4, 1,   3] },
  jack:  { key:'jack',  label:'J',  kind:'rank', cls:'rank-jack',  pay:[0.6, 1.5, 4] },
  queen: { key:'queen', label:'Q',  kind:'rank', cls:'rank-queen', pay:[0.6, 1.5, 4] },
  king:  { key:'king',  label:'K',  kind:'rank', cls:'rank-king',  pay:[0.8, 2,   6] },
  ace:   { key:'ace',   label:'A',  kind:'rank', cls:'rank-ace',   pay:[0.8, 2,   6] },
  deer:  { key:'deer',  label:'🦌', kind:'icon', pay:[1,   3,  10] },
  wolf:  { key:'wolf',  label:'🐺', kind:'icon', pay:[1.5, 5,  15] },
  eagle: { key:'eagle', label:'🦅', kind:'icon', pay:[2,   8,  25] },
  bison: { key:'bison', label:'🦬', kind:'icon', pay:[5,  20,  75] },
};
const WILD = { key:'wild', label:'🌅', pay:[8, 30, 100] };
const COIN = { key:'coin', label:'🪙' };

// Visual rarity tier per icon symbol, driving the tile styling in CSS
// (.tier-common/.tier-uncommon/.tier-rare/.tier-top) — matches the pay
// order below (deer < wolf < eagle < bison).
const ICON_TIER = { deer: 'tier-common', wolf: 'tier-uncommon', eagle: 'tier-rare', bison: 'tier-top' };

// A single spin's total win, as a multiple of the bet, that counts as a
// "Super Win" and earns its own congrats screen.
const SUPER_WIN_MULT = 40;

// Weighted symbol pool for the 3 non-coin cells of every reel column.
// Coins are rolled separately per-column (see spinColumn below) so that
// at most one coin can land per reel, matching the "2 coins = near miss,
// 3 coins = bonus" rule exactly (one bonus symbol slot per reel).
const SYMBOL_WEIGHTS = [
  ['nine', 18], ['ten', 18], ['jack', 15], ['queen', 15], ['king', 12], ['ace', 12],
  ['deer', 9], ['wolf', 7], ['eagle', 5], ['bison', 3], ['wild', 4],
];
const WEIGHT_TOTAL = SYMBOL_WEIGHTS.reduce((s, [, w]) => s + w, 0);
const COIN_CHANCE = 0.11; // per-reel chance of that reel carrying a coin this spin

function rollWeightedSymbol(){
  let r = Math.random() * WEIGHT_TOTAL;
  for (const [key, w] of SYMBOL_WEIGHTS){
    r -= w;
    if (r <= 0) return key;
  }
  return SYMBOL_WEIGHTS[0][0];
}

// Wild multiplier: rare in the base game, guaranteed (and always >=2x) in
// free spins.
const WILD_MULT_TABLE = [ [2, 50], [3, 25], [5, 15], [10, 10] ];
function rollWildMultiplier(inBonus){
  if (!inBonus && Math.random() > 0.15) return null; // base game: usually no multiplier at all
  const total = WILD_MULT_TABLE.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [mult, w] of WILD_MULT_TABLE){
    r -= w;
    if (r <= 0) return mult;
  }
  return 2;
}

const BET_LEVELS = Array.from({ length: 10 }, (_, i) => Math.round((i + 1) * 30)); // cents: 30..300
let betIndex = 0;
let slotsBusy = false;
let inFreeSpins = false;
let freeSpinsRemaining = 0;
let freeSpinsSessionWin = 0; // cents won across the whole bonus session, for the wrap-up message
let turboEnabled = false;

function currentBetCents(){ return BET_LEVELS[betIndex]; }
function currentBetDollars(){ return currentBetCents() / 100; }

/* ---------------- reel DOM ----------------
   Each of the 5 columns independently shows anywhere from 2 to 7 symbols
   a spin — not a fixed 3-row grid. Every column always fills the SAME
   full reel-window height though: cell width (--cw) is shared, but cell
   height (--rh) is computed per column (availableHeight / thatColumn's
   row count) and recomputed every spin, so a 2-row column gets two tall
   tiles and a 7-row column gets seven short ones — no column ever looks
   short/sparse next to a taller one. See sizeReels(). */
const REEL_COUNT = 5;
const MIN_ROWS = 2;
const MAX_ROWS = 7;
function randomRowCount(){ return MIN_ROWS + Math.floor(Math.random() * (MAX_ROWS - MIN_ROWS + 1)); }

function symbolData(key){
  if (key === 'wild') return WILD;
  if (key === 'coin') return COIN;
  return SLOT_SYMBOLS[key];
}

function buildSymbolCellEl(key, wildMult){
  const cell = document.createElement('div');
  cell.className = 'reel-cell';
  const sym = document.createElement('div');
  const data = symbolData(key);
  if (data.kind === 'rank'){
    sym.className = 'reel-symbol rank-badge ' + data.cls;
    sym.textContent = data.label;
  } else if (key === 'wild'){
    sym.className = 'reel-symbol wild-symbol';
    sym.textContent = data.label;
    if (wildMult){
      const badge = document.createElement('span');
      badge.className = 'wild-mult';
      badge.textContent = wildMult + '×';
      sym.appendChild(badge);
    }
  } else if (key === 'coin'){
    sym.className = 'reel-symbol coin-symbol';
    sym.textContent = data.label;
  } else {
    // Rarity tiers (common -> top) so the biggest payers (bison) read as
    // visibly more premium — richer gradient, gold rim, shimmer sweep.
    const tierCls = ICON_TIER[key] || '';
    sym.className = ('reel-symbol icon-symbol ' + tierCls).trim();
    sym.textContent = data.label;
  }
  cell.appendChild(sym);
  return cell;
}

let reelEls = []; // { col, mask, strip }
let cwPx = 64; // current cell width (shared by every column), recomputed each spin
let rhPxByCol = []; // current cell height PER COLUMN — see sizeReels()
let fillerCountByCol = []; // how many filler cells precede the final rows in each column's strip THIS spin — needed to map a final row index back to its DOM cell for win highlighting

function initSlotsReels(){
  const window_ = document.getElementById('reel-window');
  if (!window_ || window_.children.length) return; // already built
  const restRows = [];
  for (let c = 0; c < REEL_COUNT; c++){
    const col = document.createElement('div');
    col.className = 'reel-col';
    const mask = document.createElement('div');
    mask.className = 'reel-mask';
    const strip = document.createElement('div');
    strip.className = 'reel-strip';
    mask.appendChild(strip);
    col.appendChild(mask);
    window_.appendChild(col);
    reelEls.push({ col, mask, strip });
    restRows.push(randomRowCount());
  }
  sizeReels(restRows);
  reelEls.forEach((re, c) => {
    // Resting symbols so the cabinet isn't empty before the first spin.
    for (let r = 0; r < restRows[c]; r++) re.strip.appendChild(buildSymbolCellEl(rollWeightedSymbol(), null));
  });
}

/* Recompute cell sizing from the reel-window's actual box (it's a flex:1
   region, so its size doesn't depend on the reel content). Cell WIDTH is
   shared by every column (they sit side by side), but cell HEIGHT is
   computed independently per column — availableHeight / thatColumn'sRows
   — so every column's stack of tiles always adds up to the SAME full
   height, whether it's 2 tall tiles or 7 short ones. A --rh custom
   property is set on each column's own mask (not on the shared
   reel-window), so it cascades to just that column's cells/glyphs
   without needing separate CSS rules per column. */
function sizeReels(colRows){
  const window_ = document.getElementById('reel-window');
  if (!window_) return;
  const PAD = 8, GAP = 5;
  const availW = window_.clientWidth - PAD * 2 - GAP * (REEL_COUNT - 1);
  const availH = window_.clientHeight - PAD * 2;
  // 92px was tuned for a narrow portrait phone width; on a wide-but-short
  // landscape layout (reel cabinet next to the dock, not above it) the
  // available width per column is much larger, so let the clamp track the
  // available height too instead of hard-capping at the portrait value —
  // otherwise landscape leaves big empty gutters beside the reels.
  const cwCap = Math.max(92, Math.min(150, Math.floor(availH / 2.2)));
  cwPx = Math.max(30, Math.min(cwCap, Math.floor(availW / REEL_COUNT)));
  window_.style.setProperty('--cw', cwPx + 'px');
  rhPxByCol = colRows.map(rows => Math.max(20, Math.floor(availH / rows)));
  reelEls.forEach((re, c) => {
    const rh = rhPxByCol[c];
    re.mask.style.setProperty('--rh', rh + 'px');
    re.mask.style.height = (colRows[c] * rh) + 'px';
  });
}

/* ---------------- spin generation ----------------
   Each column independently: 2-7 symbols this spin, maybe one coin (in a
   random row), the rest from the weighted pool. Returns
   { columns, colRows, coinCols, wildMultByCell }. */
function generateSpin(){
  const columns = []; // columns[c] = [rowSymbolKey x (2-7)]
  const colRows = []; // rows per column, this spin
  const coinCols = []; // bool per column
  const wildMultByCell = {}; // "c,r" -> multiplier

  for (let c = 0; c < REEL_COUNT; c++){
    const rows = randomRowCount();
    colRows.push(rows);
    const hasCoin = Math.random() < COIN_CHANCE;
    coinCols.push(hasCoin);
    const coinRow = hasCoin ? Math.floor(Math.random() * rows) : -1;
    const col = [];
    for (let r = 0; r < rows; r++){
      if (r === coinRow){ col.push('coin'); continue; }
      const key = rollWeightedSymbol();
      col.push(key);
      if (key === 'wild'){
        const mult = rollWildMultiplier(inFreeSpins);
        if (mult) wildMultByCell[c + ',' + r] = mult;
      }
    }
    columns.push(col);
  }
  return { columns, colRows, coinCols, wildMultByCell };
}

/* ---------------- win evaluation ----------------
   "Ways"-style: for every payable symbol (including a pure-wild run),
   walk columns left to right; a column counts as a match if ANY of its
   rows (each column can have a different row count, 2-7) holds that
   symbol or a wild. The longest unbroken run from column 0 that reaches
   3+ pays at that symbol's tier. Each win also records exactly which
   cells ("c,r") made it match, so only those specific tiles — not the
   whole column — get highlighted afterward. */
function evaluateWins(columns, wildMultByCell){
  const wins = []; // { key, count, amountCents, wildMult, cells:["c,r", ...] }
  const candidates = [...Object.keys(SLOT_SYMBOLS), 'wild'];

  for (const key of candidates){
    let run = 0;
    let bestWildMult = 1;
    const winningCells = [];
    for (let c = 0; c < REEL_COUNT; c++){
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
      const data = key === 'wild' ? WILD : SLOT_SYMBOLS[key];
      const payMult = data.pay[Math.min(run, 5) - 3];
      const amountCents = Math.round(currentBetCents() * payMult * bestWildMult);
      wins.push({ key, count: run, amountCents, wildMult: bestWildMult, cells: winningCells });
    }
  }
  return wins;
}

/* ---------------- spin flow ---------------- */
function setSpinBusy(busy){
  slotsBusy = busy;
  const btn = document.getElementById('btn-spin');
  const betDown = document.getElementById('bet-step-down');
  const betUp = document.getElementById('bet-step-up');
  if (btn) btn.disabled = busy || (!inFreeSpins && Math.round(account.balance * 100) < currentBetCents());
  if (betDown) betDown.disabled = busy;
  if (betUp) betUp.disabled = busy;
}

function setMessage(text){
  const el = document.getElementById('slots-message');
  if (el) el.textContent = text;
}

/* formatMoney() rounds to whole dollars everywhere else in the app (by
   design — see storage.js); slots bets/wins are cents-precise, so they
   get their own always-2-decimal formatter instead of touching that
   shared behavior. */
function formatCents(cents){
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return sign + '$' + (abs / 100).toFixed(2);
}

function refreshSlotsHud(){
  initSlotsReels();
  const el = document.getElementById('bet-value');
  if (el) el.textContent = formatCents(currentBetCents());
  setSpinBusy(slotsBusy);
  document.getElementById('free-spins-banner').hidden = !inFreeSpins;
  document.getElementById('fs-count').textContent = freeSpinsRemaining;
}

/* All 5 columns kick off their spin transform at the same moment (see
   doSpin) — what makes them stop in order, left to right, is each one
   getting a different transition `duration` (an absolute time from that
   shared start, already staggered by doSpin's stopAt[] schedule). The
   filler strip length scales with duration too, so a column spinning
   for longer scrolls through proportionally more symbols instead of
   just crawling slower over the same short distance. */
async function spinColumn(c, finalSymbols, wildMultByCell, duration, fast){
  const { strip } = reelEls[c];
  const rows = finalSymbols.length;

  // Build a long strip: some random filler, then the real final symbols
  // as the last `rows` cells, so it looks like it's spinning through and
  // then lands exactly on the result.
  strip.innerHTML = '';
  const rowsPerSecond = fast ? 46 : 20;
  const fillerCount = Math.max(fast ? 3 : 6, Math.round((duration / 1000) * rowsPerSecond));
  fillerCountByCol[c] = fillerCount;
  for (let i = 0; i < fillerCount; i++) strip.appendChild(buildSymbolCellEl(rollWeightedSymbol(), null));
  for (let r = 0; r < rows; r++){
    const key = finalSymbols[r];
    const mult = wildMultByCell[c + ',' + r] || null;
    strip.appendChild(buildSymbolCellEl(key, mult));
  }

  const travel = fillerCount * rhPxByCol[c];
  strip.style.transition = 'none';
  strip.style.transform = 'translateY(0px)';
  // eslint-disable-next-line no-unused-expressions
  strip.offsetHeight; // force reflow so the transition below actually animates
  strip.style.transition = `transform ${duration}ms cubic-bezier(.2,.7,.25,1)`;
  strip.style.transform = `translateY(-${travel}px)`;

  await new Promise(resolve => setTimeout(resolve, duration));
  beep(300 + c * 20, 0.05, 'triangle', 0.03); // a little "tick" as this reel locks in
}

function updateNearMiss(coinCols, stoppedThrough){
  const coinsSoFar = coinCols.slice(0, stoppedThrough + 1).filter(Boolean).length;
  reelEls.forEach((re, i) => re.col.classList.remove('near-miss'));
  if (coinsSoFar === 2 && stoppedThrough < REEL_COUNT - 1){
    for (let c = stoppedThrough + 1; c < REEL_COUNT; c++) reelEls[c].col.classList.add('near-miss');
  }
}

async function doSpin(){
  if (slotsBusy) return;
  const betCents = currentBetCents();
  if (!inFreeSpins){
    if (Math.round(account.balance * 100) < betCents){ setMessage("You don't have enough for that bet."); return; }
    account.balance = Math.round((account.balance * 100 - betCents)) / 100;
    saveState(account);
    refreshWalletHud();
  }

  setSpinBusy(true);
  document.getElementById('slots-win-display').hidden = true;
  reelEls.forEach(re => {
    re.col.classList.remove('near-miss');
    re.strip.querySelectorAll('.win-glow').forEach(el => el.classList.remove('win-glow'));
  });
  setMessage(inFreeSpins ? `Free spin — ${freeSpinsRemaining} left` : 'Spinning…');

  const spin = generateSpin();
  sizeReels(spin.colRows);

  // All 5 reels start spinning at the same instant. What makes them stop
  // left-to-right is that each column's transition just runs for longer
  // than the one before it — stopAt[c] is that column's absolute
  // duration from the shared start. Normally each stop is 400ms after
  // the previous one; turbo compresses that gap way down. A column
  // where a 2-coin near miss is still undecided always uses the normal
  // (non-turbo) gap for its own stop, so that reveal keeps its suspense
  // even mid-turbo-spin — and everything after it inherits the later
  // absolute time that produces, so the order is never violated.
  const NORMAL_BASE = 500, NORMAL_GAP = 400;
  const TURBO_BASE = 70, TURBO_GAP = 90;
  const stopAt = [];
  const fastFlags = [];
  let cumulative = 0;
  for (let c = 0; c < REEL_COUNT; c++){
    const coinsBefore = spin.coinCols.slice(0, c).filter(Boolean).length;
    const nearMissActive = coinsBefore === 2;
    const fast = turboEnabled && !nearMissActive;
    fastFlags.push(fast);
    if (c === 0){
      cumulative = fast ? TURBO_BASE : NORMAL_BASE;
    } else {
      cumulative += fast ? TURBO_GAP : NORMAL_GAP;
    }
    stopAt.push(cumulative);
  }

  await Promise.all(reelEls.map((re, c) =>
    spinColumn(c, spin.columns[c], spin.wildMultByCell, stopAt[c], fastFlags[c])
      .then(() => updateNearMiss(spin.coinCols, c))
  ));
  reelEls.forEach(re => re.col.classList.remove('near-miss'));

  const wins = evaluateWins(spin.columns, spin.wildMultByCell);
  const totalWinCents = wins.reduce((s, w) => s + w.amountCents, 0);
  const coinCount = spin.coinCols.filter(Boolean).length;

  if (totalWinCents > 0){
    account.balance = Math.round((account.balance * 100 + totalWinCents)) / 100;
    saveState(account);
    refreshWalletHud();
    if (inFreeSpins) freeSpinsSessionWin += totalWinCents;
    highlightWinningTiles(wins);
    document.getElementById('slots-win-amount').textContent = formatCents(totalWinCents);
    document.getElementById('slots-win-display').hidden = false;
    setMessage(describeWins(wins));
    sfxWin();

    const winMultiple = totalWinCents / betCents;
    if (winMultiple >= SUPER_WIN_MULT){
      await showSuperWinModal(totalWinCents, winMultiple);
    }
  } else {
    setMessage(inFreeSpins ? `Free spin — ${freeSpinsRemaining} left` : 'No win this spin — try again!');
  }

  await handleBonusOutcome(coinCount);
  setSpinBusy(false);
}

/* Highlights only the exact tiles that made up a win (see evaluateWins'
   `cells` list) — not the whole column — since a column can have several
   rows and only some of them (or just one) are actually part of the
   match. A strip's DOM order is [...fillerCells, ...finalRowCells], so
   final row r lives at child index fillerCountByCol[c] + r. */
function highlightWinningTiles(wins){
  const winningCells = new Set();
  wins.forEach(w => w.cells.forEach(ck => winningCells.add(ck)));
  reelEls.forEach((re, c) => {
    const filler = fillerCountByCol[c] || 0;
    const cellEls = re.strip.children;
    for (let r = 0; filler + r < cellEls.length; r++){
      const symEl = cellEls[filler + r].querySelector('.reel-symbol');
      if (symEl) symEl.classList.toggle('win-glow', winningCells.has(c + ',' + r));
    }
  });
}

function describeWins(wins){
  const best = wins.slice().sort((a, b) => b.amountCents - a.amountCents)[0];
  const data = best.key === 'wild' ? WILD : SLOT_SYMBOLS[best.key];
  const name = best.key === 'wild' ? 'Wild Sunset' : (data.kind === 'rank' ? data.label : best.key[0].toUpperCase() + best.key.slice(1));
  const multTxt = best.wildMult > 1 ? ` (${best.wildMult}× wild!)` : '';
  return `${best.count}× ${name}${multTxt} — win!`;
}

/* ---------------- bonus / free spins ---------------- */
async function handleBonusOutcome(coinCount){
  if (!inFreeSpins && coinCount >= 3){
    inFreeSpins = true;
    freeSpinsRemaining = 8;
    freeSpinsSessionWin = 0;
    await showBonusModal('🪙 Bonus Triggered!', `You landed ${coinCount} coins — 8 Free Spins awarded!`, { icon: '🔔' });
  } else if (inFreeSpins){
    // The spin that just played always counts against the total, whether
    // or not it also retriggers more — a retrigger tops the count back up,
    // it doesn't give this spin back for free.
    freeSpinsRemaining -= 1;
    if (coinCount >= 2){
      freeSpinsRemaining += 5;
      await showBonusModal('🪙 Retrigger!', `${coinCount} coins in one spin — 5 more Free Spins!`, { icon: '🔔' });
    } else if (freeSpinsRemaining <= 0){
      const wonTxt = formatCents(freeSpinsSessionWin);
      inFreeSpins = false;
      freeSpinsRemaining = 0;
      await showBonusModal('Free Spins Complete!', `You won ${wonTxt} total during your free spins.`, { icon: '🏁', celebrate: false });
    }
  }
  refreshSlotsHud();
}

/* Spawns a short burst of falling/tumbling confetti pieces inside the
   given layer element (positioned absolute, cleared on modal close). */
const CONFETTI_COLORS = ['#ffd166', '#ff8a3d', '#ff5f6d', '#7ee8a4', '#6ec6ff', '#c792ea', '#fff2b8'];
function spawnConfetti(layerEl, count = 40){
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
    p.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    p.style.animationDuration = (1.5 + Math.random() * 1.3) + 's';
    p.style.animationDelay = (Math.random() * 0.35) + 's';
    p.style.transform = `rotate(${Math.floor(Math.random() * 360)}deg)`;
    frag.appendChild(p);
  }
  layerEl.appendChild(frag);
}

/* A short celebration screen (ringing bell icon + confetti burst) for a
   triggered/retriggered bonus. Pass { celebrate:false } for a plain
   recap (the free-spins wrap-up) with no confetti. */
function showBonusModal(title, text, opts = {}){
  const { celebrate = true, icon = '🔔' } = opts;
  return new Promise(resolve => {
    document.getElementById('bonus-modal-title').textContent = title;
    document.getElementById('bonus-modal-text').textContent = text;
    document.getElementById('bonus-modal-icon').textContent = icon;
    const modal = document.getElementById('bonus-modal');
    const confettiLayer = document.getElementById('bonus-confetti');
    modal.hidden = false;
    if (celebrate){
      spawnConfetti(confettiLayer);
    } else if (confettiLayer){
      confettiLayer.innerHTML = '';
    }
    sfxAchievement();
    const btn = document.getElementById('btn-bonus-continue');
    const onClick = () => {
      modal.hidden = true;
      btn.removeEventListener('click', onClick);
      resolve();
    };
    btn.addEventListener('click', onClick);
  });
}

/* A bigger congrats screen for any single spin that wins >= SUPER_WIN_MULT
   times the bet — trophy icon, confetti, gold-ray backdrop. */
function showSuperWinModal(amountCents, multiple){
  return new Promise(resolve => {
    document.getElementById('superwin-amount').textContent = formatCents(amountCents);
    document.getElementById('superwin-sub').textContent = `${multiple.toFixed(1)}× your bet!`;
    const modal = document.getElementById('superwin-modal');
    modal.hidden = false;
    spawnConfetti(document.getElementById('superwin-confetti'), 60);
    sfxAchievement();
    setTimeout(() => sfxWin(), 200);
    const btn = document.getElementById('btn-superwin-continue');
    const onClick = () => {
      modal.hidden = true;
      btn.removeEventListener('click', onClick);
      resolve();
    };
    btn.addEventListener('click', onClick);
  });
}

/* ---------------- paytable ---------------- */
function buildPaytable(){
  const list = document.getElementById('paytable-list');
  if (!list || list.children.length) return;
  const order = ['bison', 'eagle', 'wolf', 'deer', 'ace', 'king', 'queen', 'jack', 'ten', 'nine'];
  const rows = [
    { key: 'wild', data: WILD, note: 'Wild — substitutes for any symbol, rare multiplier (always in free spins)' },
    ...order.map(k => ({ key: k, data: SLOT_SYMBOLS[k] })),
    { key: 'coin', data: COIN, note: '3 anywhere = 8 Free Spins · 2+ in a free spin = +5 more' },
  ];
  rows.forEach(({ key, data, note }) => {
    const row = document.createElement('div');
    row.className = 'paytable-row';
    row.appendChild(buildSymbolCellEl(key, key === 'wild' ? 5 : null).firstChild);
    const pays = document.createElement('div');
    pays.className = 'paytable-row-pays';
    if (data.pay){
      pays.innerHTML = `<span>3: <strong>${data.pay[0]}×</strong></span><span>4: <strong>${data.pay[1]}×</strong></span><span>5: <strong>${data.pay[2]}×</strong></span>`;
    } else {
      pays.innerHTML = `<span>${note}</span>`;
      pays.style.fontSize = '.68rem';
    }
    row.appendChild(pays);
    list.appendChild(row);
  });
}

/* ---------------- wiring ---------------- */
document.getElementById('btn-spin').addEventListener('click', doSpin);
document.getElementById('btn-turbo').addEventListener('click', () => {
  turboEnabled = !turboEnabled;
  document.getElementById('btn-turbo').classList.toggle('active', turboEnabled);
  sfxChip();
});
document.getElementById('bet-step-down').addEventListener('click', () => {
  if (betIndex > 0){ betIndex--; refreshSlotsHud(); sfxChip(); }
});
document.getElementById('bet-step-up').addEventListener('click', () => {
  if (betIndex < BET_LEVELS.length - 1){ betIndex++; refreshSlotsHud(); sfxChip(); }
});
document.getElementById('btn-paytable').addEventListener('click', () => {
  buildPaytable();
  document.getElementById('paytable-modal').hidden = false;
});
document.getElementById('btn-paytable-close').addEventListener('click', () => {
  document.getElementById('paytable-modal').hidden = true;
});
document.getElementById('paytable-modal').addEventListener('click', e => {
  if (e.target.id === 'paytable-modal') document.getElementById('paytable-modal').hidden = true;
});
