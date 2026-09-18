/* =========================================================
   ui.js — DOM wiring: navigation, blackjack table rendering,
   history/achievements/settings screens, toasts, sound.
   ========================================================= */

let account = loadState();
let game = new BlackjackGame(account.settings.decks);

let betPerHand = 25;
let numHandsSelected = 1;

// How long a single card takes to fly from the dealer's shoe to its slot.
// "normal" is a quick, snappy 0.5s per card; slow/fast scale from there.
const SPEED_MS = { slow: 800, normal: 500, fast: 250 };
function dealMs(){ return SPEED_MS[account.settings.speed] || SPEED_MS.normal; }
function flipMs(){ return Math.max(180, Math.round(dealMs() * 0.5)); }
function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

// How fast the slot columns spin (Settings → Reel Spin Speed), shared by both
// Sunset Stampede and Neon Overdrive. A multiplier > 1 stretches out each
// column's stop timing AND slows its visual scroll rate (see reelSpeedScale
// usage in slots.js/neon.js), so "Relaxed" genuinely looks lazier rather than
// just taking longer to lock in the same-speed scroll. Turbo mode ignores
// this entirely — it's a separate, always-blazing-fast override.
const REEL_SPEED_SCALE = { slow: 1.5, normal: 1, fast: 0.55 };
function reelSpeedScale(){ return REEL_SPEED_SCALE[account.settings.reelSpeed] || 1; }

/* ---------------- audio (procedurally synthesized, no external assets) ----
   Everything here is built at runtime from oscillators + filtered noise —
   there are no sound files to ship. The palette is modeled after typical
   slot-machine/casino sound design: short filtered-noise transients for
   physical actions (cards, chips, reels), and bright layered "chime" tones
   — a fundamental plus a couple of quiet detuned overtones, like a small
   bell — strung into quick ascending runs for payouts. Bigger wins get a
   longer, denser run plus a high shimmer tail so they read as more of a
   moment than a small win's quick 3-note tick-up. Everything is gated by
   account.settings.sound (Settings → Sound Effects), which the player can
   flip off at any time. */
let audioCtx = null;
let masterBus = null; // shared limiter every sfx/ambience node routes through, so the louder mix below can't clip
function getAudioCtx(){
  if (!account.settings.sound) return null;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch (e) { return null; }
}
/** Every sound (sfx AND ambience) connects here instead of straight to
    ctx.destination — a soft limiter so turning everything up doesn't risk
    harsh clipping when several sounds land at once (a spin win plus reel
    ticks plus the ambience bed, say). */
function getMasterBus(){
  const ctx = getAudioCtx();
  if (!ctx) return null;
  if (!masterBus){
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8; limiter.knee.value = 12; limiter.ratio.value = 6;
    limiter.attack.value = 0.002; limiter.release.value = 0.15;
    limiter.connect(ctx.destination);
    masterBus = limiter;
  }
  return masterBus;
}

// A flat multiplier on every effect's own `vol` — turn this one knob to
// make everything louder/quieter together instead of re-tuning each call
// site. AMBIENCE_GAIN (below) is set well under a typical sfx peak so
// effects always read as louder than the background music, as requested.
const SFX_MASTER_GAIN = 1.8;

/** A single oscillator blip — light ticks/clicks (chip stepper, reel lock-in). */
function beep(freq = 440, dur = 0.08, type = 'sine', vol = 0.05, delay = 0){
  const ctx = getAudioCtx();
  const bus = getMasterBus();
  if (!ctx || !bus) return;
  try {
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(vol * SFX_MASTER_GAIN, 0.0001), t0 + Math.min(0.01, dur * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(bus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch (e) { /* ignore */ }
}

/** A short burst of filtered noise, with its decay baked into the buffer —
    card snaps/slides, chip clacks, reel-lock clicks, shimmer tails. */
function noiseBurst(dur = 0.05, opts = {}){
  const { type = 'highpass', freq = 2000, q = 0.7, vol = 0.05, delay = 0 } = opts;
  const ctx = getAudioCtx();
  const bus = getMasterBus();
  if (!ctx || !bus) return;
  try {
    const t0 = ctx.currentTime + delay;
    const bufSize = Math.max(1, Math.round(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filt = ctx.createBiquadFilter();
    filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol * SFX_MASTER_GAIN, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt).connect(gain).connect(bus);
    src.start(t0);
  } catch (e) { /* ignore */ }
}

/** A small bright "bell": a fundamental plus two quiet detuned overtones,
    each with its own quick decay. This is the sparkly layer behind every
    win sound below. */
function chime(freq = 660, dur = 0.32, vol = 0.06, delay = 0){
  const ctx = getAudioCtx();
  const bus = getMasterBus();
  if (!ctx || !bus) return;
  try {
    const t0 = ctx.currentTime + delay;
    [[1, 1, vol], [2.01, 0.45, vol * 0.5], [3.99, 0.22, vol * 0.25]].forEach(([mult, decayMult, v]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      const d = dur * decayMult + dur * 0.4;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(Math.max(v * SFX_MASTER_GAIN, 0.0001), t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      osc.connect(gain).connect(bus);
      osc.start(t0);
      osc.stop(t0 + d + 0.02);
    });
  } catch (e) { /* ignore */ }
}

/** A run of chimes climbing in pitch, each one's step/gap lightly jittered
    so it doesn't sound mechanical — the "coin cascade" behind bonus/win
    celebrations, closest in spirit to a real slot machine payout run. */
function chimeRun(count, opts = {}){
  const { startFreq = 660, step = 1.18, stepJitter = 0.05, gap = 0.08, gapJitter = 0.02, dur = 0.26, vol = 0.055 } = opts;
  let f = startFreq;
  for (let i = 0; i < count; i++){
    const stepJ = 1 + (Math.random() * 2 - 1) * stepJitter;
    const gapJ = (Math.random() * 2 - 1) * gapJitter;
    chime(f, dur, vol * (0.85 + Math.random() * 0.3), i * gap + gapJ);
    f *= step * stepJ;
  }
}

/** A bright high-frequency shimmer accent, layered on top of the biggest
    wins — echoes the sparkle/twinkle heard on real jackpot reveals. */
function sfxSparkle(){
  for (let i = 0; i < 6; i++){
    beep(2800 + Math.random() * 3200, 0.05, 'sine', 0.012, i * 0.03);
  }
  noiseBurst(0.45, { type: 'highpass', freq: 6000, q: 0.4, vol: 0.014 });
}

const sfxDeal = () => { noiseBurst(0.05, { type: 'bandpass', freq: 2200, q: 0.9, vol: 0.05 }); beep(300, 0.04, 'triangle', 0.02, 0.008); };
const sfxFlip = () => { noiseBurst(0.03, { type: 'highpass', freq: 3500, q: 0.8, vol: 0.06 }); beep(220, 0.03, 'square', 0.015, 0.01); };
const sfxChip = () => { noiseBurst(0.035, { type: 'bandpass', freq: 1800, q: 1.4, vol: 0.045 }); beep(760, 0.035, 'square', 0.03); };
const sfxReelTick = (i = 0) => { noiseBurst(0.02, { type: 'bandpass', freq: 1300 + i * 40, q: 2.2, vol: 0.03 }); beep(320 + i * 18, 0.04, 'triangle', 0.022); };
const sfxWheelTick = () => noiseBurst(0.03, { type: 'bandpass', freq: 2600, q: 4, vol: 0.045 });
const sfxLose = () => beep(160, 0.18, 'sawtooth', 0.04);
/** A quick 3-note ascending chime — small/ordinary wins. */
const sfxWin = () => chimeRun(3, { startFreq: 523.25, step: 1.26, gap: 0.09, dur: 0.26, vol: 0.055 });
/** A 4-note run — bonus triggers/retriggers, achievement toasts, wheel opening. */
const sfxAchievement = () => chimeRun(4, { startFreq: 587.33, step: 1.22, gap: 0.085, dur: 0.28, vol: 0.06 });
/** A long cascading run plus a sparkle tail — free-spins totals, the bonus
    wheel's top tiers, and any single-spin super win. The centerpiece "big
    dopamine hit" sound. */
const sfxBigWin = () => { chimeRun(9, { startFreq: 523.25, step: 1.15, stepJitter: 0.05, gap: 0.065, gapJitter: 0.015, dur: 0.34, vol: 0.06 }); setTimeout(() => sfxSparkle(), 90); };

/* ---------------- background ambience ----------------
   A quiet, continuous synthesized pad — a few detuned oscillators through
   a slowly-modulated filter, not a looped audio file — that plays for as
   long as the player is on a game screen (Blackjack, Sunset Stampede,
   Neon Overdrive) and fades out the moment they leave it. Each game gets
   its own register/waveform/filter so it doesn't feel like the exact same
   loop everywhere. Its gain (AMBIENCE_GAIN) is set well under a typical
   sfx hit's peak — see SFX_MASTER_GAIN above — so effects always cut
   through it clearly instead of competing with it. */
const AMBIENCE_GAIN = 0.028;
const AMBIENCE_THEMES = {
  blackjack: { root: 110,    waveA: 'triangle', waveB: 'sine',     filterHz: 900,  filterSwing: .35, lfoHz: 0.055, detune: 4 },
  slots:     { root: 146.83, waveA: 'triangle', waveB: 'sine',     filterHz: 1300, filterSwing: .3,  lfoHz: 0.08,  detune: 5 },
  neon:      { root: 98,     waveA: 'sawtooth', waveB: 'triangle', filterHz: 650,  filterSwing: .5,  lfoHz: 0.12,  detune: 7 },
};
let ambience = null; // { master, filter, lfo, oscs } while a bed is playing, else null
function startAmbience(themeKey){
  stopAmbience(true); // always clear out any previous bed first
  const ctx = getAudioCtx();
  const bus = getMasterBus();
  const theme = AMBIENCE_THEMES[themeKey];
  if (!ctx || !bus || !theme) return;
  try {
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(AMBIENCE_GAIN, ctx.currentTime + 2.2); // slow fade-in, never a hard start
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = theme.filterHz;
    filter.Q.value = 0.6;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = theme.lfoHz;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = theme.filterHz * theme.filterSwing;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    // A simple open root/fifth/octave chord — calm, not melodic.
    const oscs = [];
    [[1, theme.waveA, 0, 1], [1.5, theme.waveB, theme.detune, 0.5], [2, theme.waveA, -theme.detune, 0.4]]
      .forEach(([mult, wave, det, level]) => {
        const osc = ctx.createOscillator();
        osc.type = wave;
        osc.frequency.value = theme.root * mult;
        osc.detune.value = det;
        const g = ctx.createGain();
        g.gain.value = level;
        osc.connect(g).connect(filter);
        osc.start();
        oscs.push(osc);
      });

    filter.connect(master).connect(bus);
    ambience = { master, filter, lfo, oscs };
  } catch (e) { /* ignore */ }
}
function stopAmbience(instant){
  if (!ambience || !audioCtx) return;
  const { master, lfo, oscs } = ambience;
  ambience = null;
  try {
    const now = audioCtx.currentTime;
    const fade = instant ? 0.05 : 0.9;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
    master.gain.exponentialRampToValueAtTime(0.0001, now + fade);
    setTimeout(() => { try { lfo.stop(); oscs.forEach(o => o.stop()); } catch (e2) { /* ignore */ } }, fade * 1000 + 60);
  } catch (e) { /* ignore */ }
}
/** Re-checks the currently active screen against the sound setting — used
    right after the player flips Sound Effects on/off in Settings, so
    ambience starts/stops immediately instead of waiting for the next nav. */
function syncAmbienceToCurrentScreen(){
  const activeId = document.querySelector('.screen.active')?.id?.replace('screen-', '');
  if (['blackjack', 'slots', 'neon'].includes(activeId)) startAmbience(activeId);
  else stopAmbience();
}

/* ---------------- navigation ---------------- */
function goTo(screenId){
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + screenId));
  document.querySelectorAll('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.nav === screenId));
  if (screenId === 'history') renderHistory();
  if (screenId === 'achievements') renderAchievements();
  if (screenId === 'settings') renderSettings();
  if (screenId === 'lobby') renderLobby();
  if (screenId === 'slots') refreshSlotsHud();
  if (screenId === 'neon') refreshNeonHud();
  if (['blackjack', 'slots', 'neon'].includes(screenId)) startAmbience(screenId); else stopAmbience();
}

document.querySelectorAll('[data-nav]').forEach(el => {
  el.addEventListener('click', () => goTo(el.dataset.nav));
});

/* ---------------- wallet / bank / lobby HUD ---------------- */
function refreshWalletHud(){
  const balanceText = formatMoney(account.balance);
  const bankText = formatMoney(account.bank);
  document.querySelectorAll('.wallet-amount').forEach(el => { el.textContent = balanceText; });
  // Bank balance is intentionally NOT shown in the always-visible header pill —
  // it only appears in the bank modal itself and on the lobby/settings screens,
  // which the player has to actively open to see it.
  const lobbyBank = document.getElementById('lobby-bank');
  if (lobbyBank) lobbyBank.textContent = bankText;
  const settingsBank = document.getElementById('settings-bank-balance');
  if (settingsBank) settingsBank.textContent = bankText;
  refreshBankModal();
}

function renderLobby(){
  document.getElementById('lobby-balance').textContent = formatMoney(account.balance);
  const net = lifetimeNet(account);
  const netEl = document.getElementById('lobby-net');
  netEl.textContent = formatMoney(net);
  netEl.style.color = net > 0 ? 'var(--win)' : (net < 0 ? 'var(--loss)' : '');
  document.getElementById('lobby-hands').textContent = account.stats.handsPlayed.toLocaleString('en-US');
  document.getElementById('lobby-added').textContent = formatMoney(account.stats.totalAdded);
  document.getElementById('lobby-bank').textContent = formatMoney(account.bank);
}

/* ---------------- bank (move money out of play, and back) ---------------- */
const bankModal = document.getElementById('bank-modal');

function refreshBankModal(){
  const balEl = document.getElementById('bank-modal-balance');
  const bankEl = document.getElementById('bank-modal-bank');
  if (balEl) balEl.textContent = formatMoney(account.balance);
  if (bankEl) bankEl.textContent = formatMoney(account.bank);
}

function showBankError(msg){
  const el = document.getElementById('bank-error');
  el.textContent = msg;
  el.hidden = !msg;
}

function openBank(){
  refreshBankModal();
  showBankError('');
  document.getElementById('bank-deposit-input').value = '';
  document.getElementById('bank-withdraw-input').value = '';
  bankModal.hidden = false;
}

function closeBank(){
  bankModal.hidden = true;
}

document.querySelectorAll('.bank-pill, [data-nav-bank], #btn-open-bank-settings').forEach(el => {
  el.addEventListener('click', openBank);
});
document.getElementById('btn-bank-close').addEventListener('click', closeBank);
bankModal.addEventListener('click', e => { if (e.target === bankModal) closeBank(); });

document.getElementById('btn-bank-deposit').addEventListener('click', () => {
  const input = document.getElementById('bank-deposit-input');
  const amt = Math.round(parseFloat(input.value));
  if (!amt || amt <= 0){ showBankError('Enter an amount to move to the bank.'); return; }
  if (amt > account.balance){ showBankError("You don't have that much in your bankroll."); return; }
  depositToBank(account, amt);
  input.value = '';
  showBankError('');
  refreshWalletHud();
  renderLobby();
  renderSettings();
  updateBetSetupUI();
});

document.getElementById('btn-bank-withdraw').addEventListener('click', () => {
  const input = document.getElementById('bank-withdraw-input');
  const amt = Math.round(parseFloat(input.value));
  if (!amt || amt <= 0){ showBankError('Enter an amount to withdraw.'); return; }
  if (amt > account.bank){ showBankError("You don't have that much banked."); return; }
  withdrawFromBank(account, amt);
  input.value = '';
  showBankError('');
  refreshWalletHud();
  renderLobby();
  renderSettings();
  updateBetSetupUI();
});

/* ---------------- toasts ---------------- */
function showToast(achv){
  const stack = document.getElementById('toast-stack');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `
    <span class="toast-icon">${achv.icon}</span>
    <div>
      <div class="toast-title">Achievement Unlocked</div>
      <p class="toast-desc"><strong>${achv.name}</strong> &mdash; ${achv.desc}</p>
    </div>`;
  stack.appendChild(el);
  sfxAchievement();
  setTimeout(() => el.remove(), 4000);
}

function runAchievementCheck(){
  const unlocked = checkAchievements(account);
  unlocked.forEach((a, i) => setTimeout(() => showToast(a), i * 350));
}

/* ==================================================================
   BLACKJACK TABLE
   ================================================================== */

const dockBetSetup = document.getElementById('dock-betsetup');
const dockActions = document.getElementById('dock-actions');
const btnDeal = document.getElementById('btn-deal');
const btnHit = document.getElementById('btn-hit');
const btnStand = document.getElementById('btn-stand');
const btnDouble = document.getElementById('btn-double');
const btnSplit = document.getElementById('btn-split');
const btnNewRound = document.getElementById('btn-newround');
const betTotalDisplay = document.getElementById('bet-total-display');
const handCountValue = document.getElementById('hand-count-value');
const tableMessage = document.getElementById('table-message');
const tableFelt = document.querySelector('.table-felt');

/** Before any cards are dealt, show empty betting-circle placeholders on the
 *  felt for however many hands are currently selected — like a real table's
 *  marked betting spots — instead of a blank stretch of green. */
function renderBettingPreview(){
  if (game.phase !== 'betting') return;
  const area = document.getElementById('player-area');
  area.innerHTML = '';
  for (let i = 0; i < numHandsSelected; i++){
    const slot = document.createElement('div');
    slot.className = 'hand-slot betting-preview';
    const row = document.createElement('div');
    row.className = 'hand-row';
    slot.appendChild(row);
    area.appendChild(slot);
  }
}

function updateBetSetupUI(){
  handCountValue.textContent = numHandsSelected;
  const total = betPerHand * numHandsSelected;
  betTotalDisplay.textContent = formatMoney(total);
  const overBudget = total > account.balance;
  betTotalDisplay.style.color = overBudget ? 'var(--loss)' : '';
  btnDeal.disabled = total <= 0 || overBudget;
  renderBettingPreview();
}

document.getElementById('hand-count-stepper').addEventListener('click', e => {
  const btn = e.target.closest('.stepper-btn');
  if (!btn) return;
  const delta = parseInt(btn.dataset.step, 10);
  numHandsSelected = Math.min(MAX_HANDS, Math.max(1, numHandsSelected + delta));
  updateBetSetupUI();
});

document.getElementById('chip-rail').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const val = chip.dataset.chip;
  if (val === 'clear'){
    betPerHand = 0;
  } else {
    betPerHand += parseInt(val, 10);
    sfxChip();
  }
  updateBetSetupUI();
});

/** Show the bottom-right index only on the last (fully exposed) card in a fanned row. */
function markLastCard(rowEl){
  rowEl.querySelectorAll('.card.is-last').forEach(c => c.classList.remove('is-last'));
  const cards = rowEl.querySelectorAll('.card');
  if (cards.length) cards[cards.length - 1].classList.add('is-last');
}

function setTableMessage(msg){
  tableMessage.textContent = msg;
}

let isAnimating = false;
// The engine resolves win/lose the instant the last hand action happens —
// well before the dealer's cards are animated onto the table. This flag is
// what actually gates showing outcomes/coloring in the UI, so nothing about
// the result leaks out until the dealer's whole hand has been revealed.
let resultsRevealed = false;

/* ---- per-hand DOM (kept attached to the hand object itself, so it survives
   re-ordering across a split without losing already-dealt cards) ---- */
function ensureHandDom(hand){
  if (hand.dom) return hand.dom;

  const slot = document.createElement('div');
  slot.className = 'hand-slot';

  const betChip = document.createElement('div');
  betChip.className = 'hand-bet-chip';
  slot.appendChild(betChip);

  const row = document.createElement('div');
  row.className = 'hand-row';
  slot.appendChild(row);

  const total = document.createElement('div');
  total.className = 'hand-total';
  slot.appendChild(total);

  const outcome = document.createElement('div');
  outcome.className = 'hand-outcome';
  slot.appendChild(outcome);

  const presetLabel = document.createElement('div');
  presetLabel.className = 'preset-label';
  presetLabel.textContent = 'First move';
  presetLabel.hidden = true;
  slot.appendChild(presetLabel);

  const presetWrap = document.createElement('div');
  presetWrap.className = 'preset-picker';
  presetWrap.hidden = true;
  const presetBtns = {};
  [['hit', 'Hit'], ['stand', 'Stand'], ['double', 'Dbl'], ['split', 'Split']].forEach(([move, label]) => {
    const b = document.createElement('button');
    b.className = 'preset-btn';
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => setPreset(hand, move));
    presetWrap.appendChild(b);
    presetBtns[move] = b;
  });
  const clearBtn = document.createElement('button');
  clearBtn.className = 'preset-btn preset-clear';
  clearBtn.type = 'button';
  clearBtn.textContent = '✕';
  clearBtn.title = 'Clear preset';
  clearBtn.addEventListener('click', () => setPreset(hand, null));
  presetWrap.appendChild(clearBtn);
  slot.appendChild(presetWrap);

  hand.dom = { slot, betChip, row, total, outcome, presetLabel, presetWrap, presetBtns };
  return hand.dom;
}

/** Set (or clear) the pre-selected first move for a hand that's still
 *  waiting its turn. Consumed automatically the moment play reaches it. */
function setPreset(hand, move){
  hand.presetMove = move;
  const dom = hand.dom;
  if (!dom || !dom.presetBtns) return;
  Object.entries(dom.presetBtns).forEach(([m, btn]) => btn.classList.toggle('selected', move === m));
}

/** Re-appends every hand's slot in game.hands order — moves existing nodes
 *  (no re-creation, no lost cards) rather than rebuilding them. */
function layoutPlayerArea(){
  const area = document.getElementById('player-area');
  game.hands.forEach(h => area.appendChild(ensureHandDom(h).slot));
}

/** Cheap text/class refresh — never touches already-dealt card elements. */
function refreshHandSlotsStatus(){
  const active = game.activeHand();
  const spareBalance = account.balance - game.hands.reduce((s, h) => s + h.bet, 0);

  // 4+ hand rounds "zoom in" to whichever hand is currently being played —
  // the rest stay off-screen so the active hand and the dealer's cards get
  // the full close-up view instead of everything being squeezed side by
  // side. 3 or fewer hands already fit comfortably in one row, so they stay
  // zoomed out the whole time. It zooms back out once play moves past the
  // player's turn, so the full table (and every hand's outcome) is visible
  // again for the result.
  const area = document.getElementById('player-area');
  const progress = document.getElementById('hand-progress');
  const zoomed = game.hands.length > 3 && game.phase === 'playerTurn';
  area.classList.toggle('zoomed', zoomed);
  if (zoomed && active){
    const idx = game.hands.indexOf(active) + 1;
    progress.textContent = `Hand ${idx} of ${game.hands.length}`;
    progress.hidden = false;
  } else {
    progress.hidden = true;
  }

  game.hands.forEach(h => {
    const dom = ensureHandDom(h);
    dom.betChip.textContent = formatMoney(h.bet);
    dom.total.textContent = h.cards.length ? handValue(h.cards) : '';
    dom.slot.classList.toggle('is-active', game.phase === 'playerTurn' && h === active);
    dom.slot.classList.toggle('is-bust', resultsRevealed && h.status === 'bust');
    dom.slot.classList.toggle('is-blackjack', resultsRevealed && h.status === 'blackjack');

    if (resultsRevealed && h.outcome){
      const labels = { win: 'WIN', blackjack: 'BLACKJACK!', push: 'PUSH', loss: 'LOSE' };
      dom.outcome.textContent = `${labels[h.outcome]} ${h.net > 0 ? formatMoney(h.net) : (h.net < 0 ? formatMoney(h.net) : '')}`;
      dom.outcome.className = 'hand-outcome ' + (h.outcome === 'win' || h.outcome === 'blackjack' ? 'win' : (h.outcome === 'push' ? 'push' : 'loss'));
    } else {
      dom.outcome.textContent = '';
      dom.outcome.className = 'hand-outcome';
    }

    // "First move" preset picker: only offered on hands still waiting their
    // turn (dealt, untouched, not the one currently being played).
    const isWaiting = game.phase === 'playerTurn' && h.status === 'active' && h !== active;
    dom.presetLabel.hidden = !isWaiting;
    dom.presetWrap.hidden = !isWaiting;
    if (isWaiting){
      dom.presetBtns.double.hidden = !(game.canDouble(h) && spareBalance >= h.bet);
      dom.presetBtns.split.hidden = !(game.canSplit(h) && spareBalance >= h.originalBet);
    }
  });

  document.getElementById('shoe-count').textContent = game.cardsRemaining();
  updateActionButtons();
}

function updateActionButtons(){
  const active = game.activeHand();
  const inTurn = game.phase === 'playerTurn';
  btnHit.disabled = isAnimating || !inTurn || !game.canHit(active);
  btnStand.disabled = isAnimating || !inTurn || !(active && active.status === 'active');
  const spareBalance = account.balance - game.hands.reduce((s, h) => s + h.bet, 0);
  btnDouble.disabled = isAnimating || !inTurn || !(game.canDouble(active) && spareBalance >= (active ? active.bet : Infinity));
  btnSplit.disabled = isAnimating || !inTurn || !(game.canSplit(active) && spareBalance >= (active ? active.originalBet : Infinity));
}

/* ---- dealing animation: cards fly in from the dealer's shoe ---- */
function dealOriginRect(){
  return document.querySelector('.shoe').getBoundingClientRect();
}

async function animateCardInto(rowEl, card, faceDown){
  const el = renderCard(card, faceDown);
  rowEl.appendChild(el);
  markLastCard(rowEl);

  const origin = dealOriginRect();
  const dest = el.getBoundingClientRect();
  const dx = (origin.left + origin.width / 2) - (dest.left + dest.width / 2);
  const dy = (origin.top + origin.height / 2) - (dest.top + dest.height / 2);

  sfxDeal();
  const anim = el.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(.5) rotate(-14deg)`, opacity: 0 },
    { transform: `translate(${dx * 0.3}px, ${dy * 0.3}px) scale(.82) rotate(-4deg)`, opacity: 1, offset: 0.65 },
    { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
  ], { duration: dealMs(), easing: 'cubic-bezier(.18,.7,.25,1)', fill: 'both' });

  try { await anim.finished; } catch (e) { /* animation cancelled — fine, ignore */ }
  return el;
}

/** Flip the dealer's face-down hole card over in place to reveal `card`. */
async function flipDealerHoleCard(card){
  const dealerRow = document.getElementById('dealer-hand');
  const holeEl = dealerRow.children[1];
  if (!holeEl) return;

  const half = Math.round(flipMs() / 2);
  sfxFlip();
  await holeEl.animate(
    [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0.05)' }],
    { duration: half, easing: 'ease-in', fill: 'forwards' }
  ).finished;

  const fresh = renderCard(card, false);
  holeEl.className = fresh.className;
  holeEl.innerHTML = fresh.innerHTML;
  markLastCard(dealerRow);

  await holeEl.animate(
    [{ transform: 'scaleX(0.05)' }, { transform: 'scaleX(1)' }],
    { duration: half, easing: 'ease-out', fill: 'forwards' }
  ).finished;
  holeEl.style.transform = '';
}

function updateDealerTotalHidden(){
  const el = document.getElementById('dealer-total');
  el.textContent = game.dealerCards[0] ? handValue([game.dealerCards[0]]) + ' + ?' : '';
}
function updateDealerTotalRevealed(cardCount){
  document.getElementById('dealer-total').textContent = handValue(game.dealerCards.slice(0, cardCount));
}

/** Deal the opening two cards to every hand and the dealer, one card at a
 *  time, in classic round-robin order (each hand, then the dealer, twice). */
async function dealInitialRound(){
  const dealerRow = document.getElementById('dealer-hand');
  dealerRow.innerHTML = '';
  document.getElementById('dealer-total').textContent = '';
  document.getElementById('player-area').innerHTML = '';

  layoutPlayerArea();
  game.hands.forEach(h => {
    h.dom.betChip.textContent = formatMoney(h.bet);
    h.dom.total.textContent = '';
    h.dom.outcome.textContent = '';
  });

  for (let slot = 0; slot < 2; slot++){
    for (const h of game.hands){
      await animateCardInto(h.dom.row, h.cards[slot], false);
      h.dom.total.textContent = handValue(h.cards.slice(0, slot + 1));
    }
    await animateCardInto(dealerRow, game.dealerCards[slot], slot === 1);
    if (slot === 0) updateDealerTotalHidden();
  }

  refreshHandSlotsStatus();
}

/** Reveal the dealer's hole card, then draw and animate in any further hits,
 *  then settle the round. Runs once play moves out of the player's turn. */
async function runDealerSequenceAndSettle(){
  const dealerRow = document.getElementById('dealer-hand');

  await sleep(300);
  await flipDealerHoleCard(game.dealerCards[1]);
  updateDealerTotalRevealed(2);

  for (let i = 2; i < game.dealerCards.length; i++){
    await animateCardInto(dealerRow, game.dealerCards[i], false);
    updateDealerTotalRevealed(i + 1);
  }

  // Only now — with every dealer card on the table — is it OK to reveal outcomes.
  resultsRevealed = true;
  settleAndShowResults();
}

function settleAndShowResults(){
  const result = game.buildRoundResult();
  recordRound(account, result);
  refreshWalletHud();
  refreshHandSlotsStatus();

  const netTotal = result.netResult;
  if (netTotal > 0) sfxWin(); else if (netTotal < 0) sfxLose();

  if (netTotal > 0) setTableMessage(`You won ${formatMoney(netTotal)} this round!`);
  else if (netTotal < 0) setTableMessage(`You lost ${formatMoney(Math.abs(netTotal))} this round.`);
  else setTableMessage('Push — bets returned.');

  [btnHit, btnStand, btnDouble, btnSplit].forEach(b => b.hidden = true);
  btnNewRound.hidden = false;

  isAnimating = false;
  runAchievementCheck();
}

/* ---- core action performers: reusable by a manual button click AND by
   the automatic "first move" preset player below ---- */
async function performHit(){
  const hand = game.activeHand();
  game.hit();
  await animateCardInto(hand.dom.row, hand.cards[hand.cards.length - 1], false);
}

async function performStand(){
  game.stand();
}

async function performDouble(){
  const hand = game.activeHand();
  game.double();
  hand.dom.betChip.textContent = formatMoney(hand.bet);
  await animateCardInto(hand.dom.row, hand.cards[hand.cards.length - 1], false);
}

async function performSplit(){
  const originalHand = game.activeHand();
  const originalIndex = game.activeHandIndex;
  const movedCardEl = originalHand.dom.row.lastElementChild; // becomes the new hand's first card

  game.split();

  const newHand = game.hands[originalIndex + 1];
  const newDom = ensureHandDom(newHand);
  newDom.betChip.textContent = formatMoney(newHand.bet);
  newDom.total.textContent = '';
  newDom.outcome.textContent = '';

  if (movedCardEl && movedCardEl.parentElement === originalHand.dom.row){
    originalHand.dom.row.removeChild(movedCardEl);
    newDom.row.appendChild(movedCardEl);
  }
  layoutPlayerArea();
  markLastCard(originalHand.dom.row);
  markLastCard(newDom.row);
  originalHand.dom.total.textContent = handValue(originalHand.cards.slice(0, 1));
  newDom.total.textContent = handValue(newHand.cards.slice(0, 1));

  // deal the two cards the split draws, one at a time
  await animateCardInto(originalHand.dom.row, originalHand.cards[originalHand.cards.length - 1], false);
  originalHand.dom.total.textContent = handValue(originalHand.cards);

  await animateCardInto(newDom.row, newHand.cards[newHand.cards.length - 1], false);
  newDom.total.textContent = handValue(newHand.cards);
}

/** If the hand that just became active has a pre-selected "first move",
 *  play it automatically (consuming it) instead of waiting on a click. */
async function maybeAutoPlayPreset(){
  const hand = game.activeHand();
  if (!hand || !hand.presetMove) return false;

  const move = hand.presetMove;
  hand.presetMove = null;
  if (hand.dom){
    hand.dom.presetWrap.hidden = true;
    hand.dom.presetLabel.hidden = true;
  }

  const spareBalance = account.balance - game.hands.reduce((s, h) => s + h.bet, 0);
  if (move === 'stand'){
    await performStand();
  } else if (move === 'hit' && game.canHit(hand)){
    await performHit();
  } else if (move === 'double' && game.canDouble(hand) && spareBalance >= hand.bet){
    await performDouble();
  } else if (move === 'split' && game.canSplit(hand) && spareBalance >= hand.originalBet){
    await performSplit();
  } else {
    return false; // no longer valid for some reason — fall back to manual play
  }
  return true;
}

/** Common tail for hit/stand/double/split: refresh the table, then either
 *  auto-play a queued preset, hand control back to the player, or run the
 *  dealer's turn. */
async function afterEngineAction(){
  refreshHandSlotsStatus();
  if (game.phase === 'playerTurn'){
    const autoPlayed = await maybeAutoPlayPreset();
    if (autoPlayed){
      await afterEngineAction();
      return;
    }
    isAnimating = false;
    updateActionButtons();
    return;
  }
  await runDealerSequenceAndSettle();
}

/* ---- insurance (offered whenever the dealer's up-card is an Ace) ---- */
function offerInsurance(){
  return new Promise(resolve => {
    const totalWager = game.hands.reduce((s, h) => s + h.originalBet, 0);
    const insuranceCost = Math.floor(totalWager / 2);
    const modal = document.getElementById('insurance-modal');
    const amountEl = document.getElementById('insurance-amount');
    const yesBtn = document.getElementById('btn-insurance-yes');
    const noBtn = document.getElementById('btn-insurance-no');

    amountEl.textContent = formatMoney(insuranceCost);
    yesBtn.disabled = insuranceCost <= 0 || insuranceCost > account.balance;
    modal.hidden = false;

    function cleanup(){
      modal.hidden = true;
      yesBtn.removeEventListener('click', onYes);
      noBtn.removeEventListener('click', onNo);
    }
    function onYes(){ game.insuranceBet = insuranceCost; cleanup(); resolve(); }
    function onNo(){ game.insuranceBet = 0; cleanup(); resolve(); }
    yesBtn.addEventListener('click', onYes);
    noBtn.addEventListener('click', onNo);
  });
}

/** Offer insurance, then peek at the hole card exactly like a real table:
 *  if the dealer does have blackjack, reveal it immediately and settle the
 *  round right there; otherwise the hole card stays hidden and play
 *  continues as normal. Returns true if the round was fully settled here. */
async function handleInsurance(){
  await offerInsurance();

  if (game.dealerHasBlackjack()){
    setTableMessage('Dealer checks the hole card…');
    await sleep(400);
    await flipDealerHoleCard(game.dealerCards[1]);
    updateDealerTotalRevealed(2);

    game.resolveEarlyDealerBlackjack();
    resultsRevealed = true;
    settleAndShowResults();
    return true;
  }

  if (game.insuranceBet > 0){
    setTableMessage('Dealer checks the hole card… no blackjack. Insurance lost.');
  }
  return false;
}

async function startRoundFlow(){
  if (isAnimating || betPerHand <= 0) return;
  const totalWager = betPerHand * numHandsSelected;
  if (totalWager > account.balance){
    setTableMessage("You don't have enough chips for that wager.");
    return;
  }

  isAnimating = true;
  resultsRevealed = false;
  btnDeal.disabled = true;

  const { reshuffled } = game.startRound(betPerHand, numHandsSelected);
  setTableMessage(reshuffled ? 'Shoe reshuffled. New cards in play.' : '');

  dockBetSetup.hidden = true;
  dockActions.hidden = false;
  btnNewRound.hidden = true;
  [btnHit, btnStand, btnDouble, btnSplit].forEach(b => { b.hidden = false; b.disabled = true; });

  await dealInitialRound();

  if (game.dealerCards[0] && game.dealerCards[0].rank === 'A'){
    const settledEarly = await handleInsurance();
    if (settledEarly) return;
  }

  if (game.phase === 'playerTurn'){
    isAnimating = false;
    updateActionButtons();
  } else {
    await runDealerSequenceAndSettle();
  }
}

async function doHit(){
  if (isAnimating || btnHit.disabled) return;
  isAnimating = true; updateActionButtons();
  await performHit();
  await afterEngineAction();
}

async function doStand(){
  if (isAnimating || btnStand.disabled) return;
  isAnimating = true; updateActionButtons();
  await performStand();
  await afterEngineAction();
}

async function doDouble(){
  if (isAnimating || btnDouble.disabled) return;
  isAnimating = true; updateActionButtons();
  await performDouble();
  await afterEngineAction();
}

async function doSplit(){
  if (isAnimating || btnSplit.disabled) return;
  isAnimating = true; updateActionButtons();
  await performSplit();
  await afterEngineAction();
}

btnDeal.addEventListener('click', startRoundFlow);
btnHit.addEventListener('click', doHit);
btnStand.addEventListener('click', doStand);
btnDouble.addEventListener('click', doDouble);
btnSplit.addEventListener('click', doSplit);

btnNewRound.addEventListener('click', () => {
  if (isAnimating) return;
  game.reset();
  resultsRevealed = false;
  document.getElementById('insurance-modal').hidden = true;
  dockBetSetup.hidden = false;
  dockActions.hidden = true;
  setTableMessage('');
  document.getElementById('dealer-hand').innerHTML = '';
  document.getElementById('dealer-total').textContent = '';
  document.getElementById('player-area').innerHTML = '';
  updateBetSetupUI();
});

function applyFeltColor(){
  tableFelt.classList.remove('felt-red', 'felt-blue', 'felt-black');
  if (account.settings.felt !== 'green') tableFelt.classList.add('felt-' + account.settings.felt);
}

/* ==================================================================
   HISTORY
   ================================================================== */
function renderHistory(){
  const body = document.getElementById('history-body');
  const empty = document.getElementById('history-empty');
  const summary = document.getElementById('history-summary');

  summary.textContent = `${account.stats.roundsPlayed.toLocaleString('en-US')} rounds played · Lifetime net ${formatMoney(lifetimeNet(account))}`;

  if (!account.history.length){
    body.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  body.innerHTML = account.history.map((entry, i) => {
    const idx = account.history.length - i;
    const date = new Date(entry.timestamp).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    const cls = entry.netResult > 0 ? 'result-win' : (entry.netResult < 0 ? 'result-loss' : 'result-push');
    const label = entry.netResult > 0 ? 'WIN' : (entry.netResult < 0 ? 'LOSS' : 'PUSH');
    return `<tr>
      <td>${idx}</td>
      <td>${date}</td>
      <td>${entry.numHands}</td>
      <td>${formatMoney(entry.totalWagered)}</td>
      <td class="${cls}">${label}</td>
      <td class="${cls}">${formatMoney(entry.netResult)}</td>
      <td>${formatMoney(entry.balanceAfter)}</td>
    </tr>`;
  }).join('');
}

/* ==================================================================
   ACHIEVEMENTS
   ================================================================== */
function renderAchievements(){
  const grid = document.getElementById('achv-grid');
  const unlockedCount = ACHIEVEMENTS.filter(a => account.achievements[a.id]).length;
  document.getElementById('achievements-summary').textContent = `${unlockedCount} / ${ACHIEVEMENTS.length} unlocked`;

  grid.innerHTML = ACHIEVEMENTS.map(a => {
    const unlocked = !!account.achievements[a.id];
    const progress = (!unlocked && a.progress) ? `<div class="achv-progress">${a.progress(account)}</div>` : '';
    return `<div class="achv-card ${unlocked ? 'unlocked' : ''}">
      <div class="achv-icon">${a.icon}</div>
      <div>
        <div class="achv-name">${a.name}</div>
        <p class="achv-desc">${a.desc}</p>
        ${progress}
      </div>
    </div>`;
  }).join('');
}

/* ==================================================================
   SETTINGS
   ================================================================== */
function renderSettings(){
  document.getElementById('settings-balance').textContent = formatMoney(account.balance);
  document.getElementById('settings-bank-balance').textContent = formatMoney(account.bank);
  document.getElementById('setting-decks').value = account.settings.decks;
  document.getElementById('setting-felt').value = account.settings.felt;
  document.getElementById('setting-sound').checked = account.settings.sound;
  document.getElementById('setting-speed').value = account.settings.speed;
  document.getElementById('setting-reelspeed').value = account.settings.reelSpeed;

  const net = lifetimeNet(account);
  const tiles = [
    ['Hands Played', account.stats.handsPlayed.toLocaleString('en-US')],
    ['Rounds Played', account.stats.roundsPlayed.toLocaleString('en-US')],
    ['Total Wagered', formatMoney(account.stats.totalWagered)],
    ['Total Won', formatMoney(account.stats.totalWon)],
    ['Total Lost', formatMoney(account.stats.totalLost)],
    ['Lifetime Net', formatMoney(net), net > 0 ? 'pos' : (net < 0 ? 'neg' : '')],
    ['Total Added To Account', formatMoney(account.stats.totalAdded)],
    ['Biggest Single Win', formatMoney(account.stats.biggestWin)],
    ['Biggest Single Loss', formatMoney(account.stats.biggestLoss)],
    ['Best Win Streak', account.stats.bestWinStreak],
    ['Blackjacks Hit', account.stats.blackjacks],
    ['Hands Busted', account.stats.busts],
  ];
  document.getElementById('settings-stat-grid').innerHTML = tiles.map(([label, value, cls]) =>
    `<div class="stat-tile">
      <div class="stat-tile-label">${label}</div>
      <div class="stat-tile-value ${cls || ''}">${value}</div>
    </div>`
  ).join('');
}

document.getElementById('btn-add-funds').addEventListener('click', () => {
  const input = document.getElementById('add-funds-input');
  const amt = parseFloat(input.value);
  if (!amt || amt <= 0) return;
  addFunds(account, amt);
  input.value = '';
  refreshWalletHud();
  renderSettings();
  updateBetSetupUI();
  runAchievementCheck();
});

document.querySelectorAll('.quick-add').forEach(btn => {
  btn.addEventListener('click', () => {
    addFunds(account, parseInt(btn.dataset.amt, 10));
    refreshWalletHud();
    renderSettings();
    updateBetSetupUI();
    runAchievementCheck();
  });
});

document.getElementById('setting-decks').addEventListener('change', e => {
  const decks = parseInt(e.target.value, 10);
  updateSettings(account, { decks });
  game.setDecks(decks);
  if (game.phase === 'betting') game.shoe = []; // forces reshuffle on next deal
});

document.getElementById('setting-felt').addEventListener('change', e => {
  updateSettings(account, { felt: e.target.value });
  applyFeltColor();
});

document.getElementById('setting-sound').addEventListener('change', e => {
  updateSettings(account, { sound: e.target.checked });
  syncAmbienceToCurrentScreen();
});

document.getElementById('setting-speed').addEventListener('change', e => {
  updateSettings(account, { speed: e.target.value });
});

document.getElementById('setting-reelspeed').addEventListener('change', e => {
  updateSettings(account, { reelSpeed: e.target.value });
});

document.getElementById('btn-reset-all').addEventListener('click', () => {
  const ok = window.confirm('Reset your entire account? This wipes your balance, bank, lifetime stats, history and achievements. This cannot be undone.');
  if (!ok) return;
  account = resetAccount();
  game = new BlackjackGame(account.settings.decks);
  numHandsSelected = 1;
  betPerHand = 25;
  refreshWalletHud();
  renderLobby();
  renderSettings();
  renderHistory();
  renderAchievements();
  applyFeltColor();
  updateBetSetupUI();
  goTo('lobby');
});
