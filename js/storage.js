/* =========================================================
   storage.js — persistent account: balance, lifetime stats,
   history and achievements. Everything lives in localStorage
   under one key so the whole account is easy to export/reset.
   ========================================================= */

const STORAGE_KEY = 'royalVegas.account.v1';
const STARTING_BALANCE = 100;
const MAX_HISTORY = 300;

function defaultState(){
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    balance: STARTING_BALANCE,
    bank: 0, // funds moved out of play — safe from the tables until withdrawn back
    settings: {
      decks: 6,
      felt: 'green',
      sound: true,
      speed: 'normal',
    },
    stats: {
      startingBalance: STARTING_BALANCE,
      totalAdded: 0,          // virtual funds the user has added over time
      handsPlayed: 0,         // individual hands (multi-hand round counts each hand)
      roundsPlayed: 0,        // deals / rounds
      totalWagered: 0,
      totalWon: 0,            // gross amount returned on winning/blackjack/push hands beyond stake
      totalLost: 0,           // gross stake lost on losing hands
      biggestWin: 0,
      biggestLoss: 0,
      currentStreak: 0,       // positive = win streak, negative = loss streak
      bestWinStreak: 0,
      worstLossStreak: 0,
      blackjacks: 0,
      busts: 0,
      handsWon: 0,
      handsLost: 0,
      handsPushed: 0,
      splitsPlayed: 0,
      doublesPlayed: 0,
      biggestSingleBet: 0,
      maxHandsInRound: 0,
      comebackAchieved: false,
      _comebackArmed: false,
    },
    history: [],
    achievements: {}, // { achId: unlockedAtISOString }
  };
}

function migrate(state){
  const fresh = defaultState();
  return {
    ...fresh,
    ...state,
    bank: typeof state.bank === 'number' && isFinite(state.bank) ? state.bank : 0,
    settings: { ...fresh.settings, ...(state.settings || {}) },
    stats: { ...fresh.stats, ...(state.stats || {}) },
    history: Array.isArray(state.history) ? state.history : [],
    achievements: state.achievements || {},
  };
}

function loadState(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return migrate(JSON.parse(raw));
  } catch (e){
    console.warn('Royal Vegas: could not read saved account, starting fresh.', e);
    return defaultState();
  }
}

function saveState(state){
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e){
    console.warn('Royal Vegas: could not save account.', e);
  }
}

function formatMoney(n){
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(Math.round(n));
  return sign + '$' + abs.toLocaleString('en-US');
}

function addFunds(state, amount){
  amount = Math.max(0, Math.round(Number(amount) || 0));
  if (amount <= 0) return state;
  state.balance += amount;
  state.stats.totalAdded += amount;
  saveState(state);
  return state;
}

/** Move money out of play and into the bank, where it can't be wagered. */
function depositToBank(state, amount){
  amount = Math.max(0, Math.round(Number(amount) || 0));
  if (amount <= 0 || amount > state.balance) return state;
  state.balance -= amount;
  state.bank += amount;
  saveState(state);
  return state;
}

/** Pull money back out of the bank and into the playable bankroll. */
function withdrawFromBank(state, amount){
  amount = Math.max(0, Math.round(Number(amount) || 0));
  if (amount <= 0 || amount > state.bank) return state;
  state.bank -= amount;
  state.balance += amount;
  saveState(state);
  return state;
}

/**
 * Record the result of a completed round (one deal, one or more hands).
 * roundResult = {
 *   numHands, totalWagered, totalReturn (amount paid back incl. stakes on wins/pushes),
 *   netResult, hands: [{bet, outcome: 'win'|'loss'|'push'|'blackjack', net, wasSplit, wasDouble, wasBust}]
 * }
 */
function recordRound(state, roundResult){
  const { numHands, totalWagered, netResult, hands, insuranceBet = 0, insuranceNet = 0 } = roundResult;

  state.balance += netResult;
  state.stats.roundsPlayed += 1;
  state.stats.handsPlayed += numHands;
  state.stats.totalWagered += totalWagered;
  state.stats.maxHandsInRound = Math.max(state.stats.maxHandsInRound, numHands);

  // Insurance is a side bet, not a hand result — it feeds total won/lost but
  // never touches hand counts, win/loss streaks, or biggest-win/loss records.
  if (insuranceNet > 0) state.stats.totalWon += insuranceNet;
  else if (insuranceNet < 0) state.stats.totalLost += Math.abs(insuranceNet);

  let roundNet = insuranceNet;
  for (const h of hands){
    roundNet += h.net;
    state.stats.biggestSingleBet = Math.max(state.stats.biggestSingleBet, h.bet);

    if (h.net > 0){
      state.stats.totalWon += h.net;
      state.stats.handsWon += 1;
      state.stats.currentStreak = state.stats.currentStreak >= 0 ? state.stats.currentStreak + 1 : 1;
      state.stats.bestWinStreak = Math.max(state.stats.bestWinStreak, state.stats.currentStreak);
      state.stats.biggestWin = Math.max(state.stats.biggestWin, h.net);
      if (state.stats._comebackArmed && state.stats.currentStreak >= 3){
        state.stats.comebackAchieved = true;
        state.stats._comebackArmed = false;
      }
    } else if (h.net < 0){
      state.stats.totalLost += Math.abs(h.net);
      state.stats.handsLost += 1;
      state.stats.currentStreak = state.stats.currentStreak <= 0 ? state.stats.currentStreak - 1 : -1;
      state.stats.worstLossStreak = Math.min(state.stats.worstLossStreak, state.stats.currentStreak);
      state.stats.biggestLoss = Math.max(state.stats.biggestLoss, Math.abs(h.net));
      if (state.stats.currentStreak <= -3) state.stats._comebackArmed = true;
    } else {
      state.stats.handsPushed += 1;
    }
    if (h.outcome === 'blackjack') state.stats.blackjacks += 1;
    if (h.wasBust) state.stats.busts += 1;
    if (h.wasSplit) state.stats.splitsPlayed += 1;
    if (h.wasDouble) state.stats.doublesPlayed += 1;
  }

  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    timestamp: new Date().toISOString(),
    numHands,
    totalWagered,
    netResult: roundNet,
    balanceAfter: state.balance,
    hands: hands.map(h => ({ bet: h.bet, outcome: h.outcome, net: h.net })),
    insuranceBet: insuranceBet || 0,
    insuranceNet: insuranceNet || 0,
  };
  state.history.unshift(entry);
  if (state.history.length > MAX_HISTORY) state.history.length = MAX_HISTORY;

  saveState(state);
  return state;
}

function updateSettings(state, partial){
  state.settings = { ...state.settings, ...partial };
  saveState(state);
  return state;
}

function unlockAchievement(state, id){
  if (state.achievements[id]) return false;
  state.achievements[id] = new Date().toISOString();
  saveState(state);
  return true;
}

function resetAccount(){
  const fresh = defaultState();
  saveState(fresh);
  return fresh;
}

function lifetimeNet(state){
  return state.stats.totalWon - state.stats.totalLost;
}
