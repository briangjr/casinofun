/* =========================================================
   ui.js — DOM wiring: navigation, blackjack table rendering,
   history/achievements/settings screens, toasts, sound.
   ========================================================= */

let account = loadState();
let game = new BlackjackGame(account.settings.decks);

let betPerHand = 25;
let numHandsSelected = 1;

const SPEED_MS = { slow: 480, normal: 300, fast: 140 };

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

function cardEl(card, faceDown){
  const el = renderCard(card, faceDown);
  el.style.animationDuration = SPEED_MS[account.settings.speed] + 'ms';
  return el;
}

/** Show the bottom-right index only on the last (fully exposed) card in a fanned row. */
function markLastCard(rowEl){
  rowEl.querySelectorAll('.card.is-last').forEach(c => c.classList.remove('is-last'));
  const cards = rowEl.querySelectorAll('.card');
  if (cards.length) cards[cards.length - 1].classList.add('is-last');
}

function renderTable(){
  // dealer
  const dealerHandEl = document.getElementById('dealer-hand');
  dealerHandEl.innerHTML = '';
  const dealerHidden = game.phase === 'playerTurn';
  game.dealerCards.forEach((c, i) => {
    dealerHandEl.appendChild(cardEl(c, dealerHidden && i === 1));
  });
  markLastCard(dealerHandEl);
  const dealerTotalEl = document.getElementById('dealer-total');
  dealerTotalEl.textContent = dealerHidden
    ? (game.dealerCards[0] ? handValue([game.dealerCards[0]]) + ' + ?' : '')
    : (game.dealerCards.length ? handValue(game.dealerCards) : '');

  // player hands
  const area = document.getElementById('player-area');
  area.innerHTML = '';
  game.hands.forEach((h, idx) => {
    const slot = document.createElement('div');
    slot.className = 'hand-slot';
    if (game.phase === 'playerTurn' && idx === game.activeHandIndex) slot.classList.add('is-active');
    if (h.status === 'bust') slot.classList.add('is-bust');
    if (h.status === 'blackjack') slot.classList.add('is-blackjack');

    const betChip = document.createElement('div');
    betChip.className = 'hand-bet-chip';
    betChip.textContent = formatMoney(h.bet);
    slot.appendChild(betChip);

    const row = document.createElement('div');
    row.className = 'hand-row';
    h.cards.forEach(c => row.appendChild(cardEl(c, false)));
    markLastCard(row);
    slot.appendChild(row);

    const total = document.createElement('div');
    total.className = 'hand-total';
    total.textContent = h.cards.length ? handValue(h.cards) : '';
    slot.appendChild(total);

    const outcome = document.createElement('div');
    outcome.className = 'hand-outcome';
    if (game.phase === 'roundOver' && h.outcome){
      const labels = { win: 'WIN', blackjack: 'BLACKJACK!', push: 'PUSH', loss: 'LOSE' };
      outcome.textContent = `${labels[h.outcome]} ${h.net > 0 ? formatMoney(h.net) : (h.net < 0 ? formatMoney(h.net) : '')}`;
      outcome.classList.add(h.outcome === 'win' || h.outcome === 'blackjack' ? 'win' : (h.outcome === 'push' ? 'push' : 'loss'));
    }
    slot.appendChild(outcome);

    area.appendChild(slot);
  });

  document.getElementById('shoe-count').textContent = game.cardsRemaining();

  // action button availability
  const active = game.activeHand();
  btnHit.disabled = !game.canHit(active);
  btnStand.disabled = !(active && active.status === 'active');
  const spareBalance = account.balance - game.hands.reduce((s, h) => s + h.bet, 0);
  btnDouble.disabled = !(game.canDouble(active) && spareBalance >= (active ? active.bet : Infinity));
  btnSplit.disabled = !(game.canSplit(active) && spareBalance >= (active ? active.originalBet : Infinity));
}

function setMessage(msg){
  tableMessage.textContent = msg;
}

function startRoundFlow(){
  if (betPerHand <= 0) return;
  const totalWager = betPerHand * numHandsSelected;
  if (totalWager > account.balance){
    setMessage("You don't have enough chips for that wager.");
    return;
  }

  const { reshuffled } = game.startRound(betPerHand, numHandsSelected);
  if (reshuffled) setMessage('Shoe reshuffled. New cards in play.');
  else setMessage('');
  sfxDeal();

  dockBetSetup.hidden = true;
  dockActions.hidden = false;
  btnNewRound.hidden = true;
  [btnHit, btnStand, btnDouble, btnSplit].forEach(b => b.hidden = false);

  renderTable();

  if (game.phase === 'roundOver'){
    finishRound();
  }
}

function afterAction(){
  renderTable();
  if (game.phase === 'roundOver'){
    finishRound();
  }
}

function finishRound(){
  const result = game.buildRoundResult();
  recordRound(account, result);
  refreshWalletHud();
  renderTable();

  const netTotal = result.netResult;
  if (netTotal > 0) sfxWin(); else if (netTotal < 0) sfxLose();

  if (netTotal > 0) setMessage(`You won ${formatMoney(netTotal)} this round!`);
  else if (netTotal < 0) setMessage(`You lost ${formatMoney(Math.abs(netTotal))} this round.`);
  else setMessage('Push — bets returned.');

  [btnHit, btnStand, btnDouble, btnSplit].forEach(b => b.hidden = true);
  btnNewRound.hidden = false;

  runAchievementCheck();
}

btnDeal.addEventListener('click', startRoundFlow);
btnHit.addEventListener('click', () => { game.hit(); afterAction(); });
btnStand.addEventListener('click', () => { game.stand(); afterAction(); });
btnDouble.addEventListener('click', () => { game.double(); afterAction(); });
btnSplit.addEventListener('click', () => { game.split(); afterAction(); });
btnNewRound.addEventListener('click', () => {
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
