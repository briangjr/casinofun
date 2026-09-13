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

/* ---------------- audio (tiny beeps, no external assets) ---------------- */
let audioCtx = null;
function beep(freq = 440, dur = 0.08, type = 'sine', vol = 0.05){
  if (!account.settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    osc.stop(audioCtx.currentTime + dur);
  } catch (e) { /* audio unsupported, ignore */ }
}
const sfxDeal = () => beep(520, 0.05, 'triangle', 0.04);
const sfxChip = () => beep(720, 0.04, 'square', 0.03);
const sfxWin = () => { beep(660, 0.09, 'sine', 0.05); setTimeout(() => beep(880, 0.12, 'sine', 0.05), 90); };
const sfxLose = () => beep(160, 0.18, 'sawtooth', 0.04);
const sfxFlip = () => beep(340, 0.07, 'sine', 0.03);
const sfxAchievement = () => { beep(784, 0.08, 'sine', 0.05); setTimeout(() => beep(988, 0.14, 'sine', 0.05), 100); };

/* ---------------- navigation ---------------- */
function goTo(screenId){
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + screenId));
  document.querySelectorAll('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.nav === screenId));
  if (screenId === 'history') renderHistory();
  if (screenId === 'achievements') renderAchievements();
  if (screenId === 'settings') renderSettings();
  if (screenId === 'lobby') renderLobby();
}

document.querySelectorAll('[data-nav]').forEach(el => {
  el.addEventListener('click', () => goTo(el.dataset.nav));
});

/* ---------------- wallet / lobby HUD ---------------- */
function refreshWalletHud(){
  document.getElementById('hud-balance').textContent = formatMoney(account.balance);
}

function renderLobby(){
  document.getElementById('lobby-balance').textContent = formatMoney(account.balance);
  const net = lifetimeNet(account);
  const netEl = document.getElementById('lobby-net');
  netEl.textContent = formatMoney(net);
  netEl.style.color = net > 0 ? 'var(--win)' : (net < 0 ? 'var(--loss)' : '');
  document.getElementById('lobby-hands').textContent = account.stats.handsPlayed.toLocaleString('en-US');
  document.getElementById('lobby-added').textContent = formatMoney(account.stats.totalAdded);
}

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

function updateBetSetupUI(){
  handCountValue.textContent = numHandsSelected;
  const total = betPerHand * numHandsSelected;
  betTotalDisplay.textContent = formatMoney(total);
  const overBudget = total > account.balance;
  betTotalDisplay.style.color = overBudget ? 'var(--loss)' : '';
  btnDeal.disabled = total <= 0 || overBudget;
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

function setMessage(msg){
  tableMessage.textContent = msg;
}

let isAnimating = false;

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

  hand.dom = { slot, betChip, row, total, outcome };
  return hand.dom;
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
  game.hands.forEach(h => {
    const dom = ensureHandDom(h);
    dom.betChip.textContent = formatMoney(h.bet);
    dom.total.textContent = h.cards.length ? handValue(h.cards) : '';
    dom.slot.classList.toggle('is-active', game.phase === 'playerTurn' && h === active);
    dom.slot.classList.toggle('is-bust', h.status === 'bust');
    dom.slot.classList.toggle('is-blackjack', h.status === 'blackjack');

    if (game.phase === 'roundOver' && h.outcome){
      const labels = { win: 'WIN', blackjack: 'BLACKJACK!', push: 'PUSH', loss: 'LOSE' };
      dom.outcome.textContent = `${labels[h.outcome]} ${h.net > 0 ? formatMoney(h.net) : (h.net < 0 ? formatMoney(h.net) : '')}`;
      dom.outcome.className = 'hand-outcome ' + (h.outcome === 'win' || h.outcome === 'blackjack' ? 'win' : (h.outcome === 'push' ? 'push' : 'loss'));
    } else {
      dom.outcome.textContent = '';
      dom.outcome.className = 'hand-outcome';
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

  settleAndShowResults();
}

function settleAndShowResults(){
  const result = game.buildRoundResult();
  recordRound(account, result);
  refreshWalletHud();
  refreshHandSlotsStatus();

  const netTotal = result.netResult;
  if (netTotal > 0) sfxWin(); else if (netTotal < 0) sfxLose();

  if (netTotal > 0) setMessage(`You won ${formatMoney(netTotal)} this round!`);
  else if (netTotal < 0) setMessage(`You lost ${formatMoney(Math.abs(netTotal))} this round.`);
  else setMessage('Push — bets returned.');

  [btnHit, btnStand, btnDouble, btnSplit].forEach(b => b.hidden = true);
  btnNewRound.hidden = false;

  isAnimating = false;
  runAchievementCheck();
}

/** Common tail for hit/stand/double/split: refresh the table, then either
 *  hand control back to the player or run the dealer's turn. */
async function afterEngineAction(){
  refreshHandSlotsStatus();
  if (game.phase === 'playerTurn'){
    isAnimating = false;
    updateActionButtons();
    return;
  }
  await runDealerSequenceAndSettle();
}

async function startRoundFlow(){
  if (isAnimating || betPerHand <= 0) return;
  const totalWager = betPerHand * numHandsSelected;
  if (totalWager > account.balance){
    setMessage("You don't have enough chips for that wager.");
    return;
  }

  isAnimating = true;
  btnDeal.disabled = true;

  const { reshuffled } = game.startRound(betPerHand, numHandsSelected);
  setMessage(reshuffled ? 'Shoe reshuffled. New cards in play.' : '');

  dockBetSetup.hidden = true;
  dockActions.hidden = false;
  btnNewRound.hidden = true;
  [btnHit, btnStand, btnDouble, btnSplit].forEach(b => { b.hidden = false; b.disabled = true; });

  await dealInitialRound();

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

  const hand = game.activeHand();
  game.hit();
  await animateCardInto(hand.dom.row, hand.cards[hand.cards.length - 1], false);

  await afterEngineAction();
}

async function doStand(){
  if (isAnimating || btnStand.disabled) return;
  isAnimating = true; updateActionButtons();

  game.stand();
  await afterEngineAction();
}

async function doDouble(){
  if (isAnimating || btnDouble.disabled) return;
  isAnimating = true; updateActionButtons();

  const hand = game.activeHand();
  game.double();
  hand.dom.betChip.textContent = formatMoney(hand.bet);
  await animateCardInto(hand.dom.row, hand.cards[hand.cards.length - 1], false);

  await afterEngineAction();
}

async function doSplit(){
  if (isAnimating || btnSplit.disabled) return;
  isAnimating = true; updateActionButtons();

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
  dockBetSetup.hidden = false;
  dockActions.hidden = true;
  setMessage('');
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
  document.getElementById('setting-decks').value = account.settings.decks;
  document.getElementById('setting-felt').value = account.settings.felt;
  document.getElementById('setting-sound').checked = account.settings.sound;
  document.getElementById('setting-speed').value = account.settings.speed;

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
});

document.getElementById('setting-speed').addEventListener('change', e => {
  updateSettings(account, { speed: e.target.value });
});

document.getElementById('btn-reset-all').addEventListener('click', () => {
  const ok = window.confirm('Reset your entire account? This wipes your balance, lifetime stats, history and achievements. This cannot be undone.');
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
