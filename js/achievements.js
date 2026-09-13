/* =========================================================
   achievements.js — badge definitions + unlock checks
   ========================================================= */

const ACHIEVEMENTS = [
  { id: 'first_hand', icon: '🃏', name: 'First Deal', desc: 'Play your very first hand.',
    check: s => s.stats.handsPlayed >= 1 },
  { id: 'first_blackjack', icon: '🂡', name: 'Natural', desc: 'Hit a blackjack.',
    check: s => s.stats.blackjacks >= 1 },
  { id: 'five_blackjacks', icon: '✨', name: 'Card Counter?', desc: 'Hit 5 blackjacks total.',
    check: s => s.stats.blackjacks >= 5, progress: s => `${Math.min(s.stats.blackjacks,5)}/5` },
  { id: 'streak_3', icon: '🔥', name: 'On a Heater', desc: 'Win 3 hands in a row.',
    check: s => s.stats.bestWinStreak >= 3 },
  { id: 'streak_5', icon: '🚀', name: 'Unstoppable', desc: 'Win 5 hands in a row.',
    check: s => s.stats.bestWinStreak >= 5 },
  { id: 'streak_10', icon: '👑', name: 'Legendary Run', desc: 'Win 10 hands in a row.',
    check: s => s.stats.bestWinStreak >= 10 },
  { id: 'hands_50', icon: '🎲', name: 'Regular', desc: 'Play 50 hands total.',
    check: s => s.stats.handsPlayed >= 50, progress: s => `${Math.min(s.stats.handsPlayed,50)}/50` },
  { id: 'hands_250', icon: '🏛️', name: 'High Roller Table', desc: 'Play 250 hands total.',
    check: s => s.stats.handsPlayed >= 250, progress: s => `${Math.min(s.stats.handsPlayed,250)}/250` },
  { id: 'hands_1000', icon: '🏆', name: 'Pit Boss', desc: 'Play 1,000 hands total.',
    check: s => s.stats.handsPlayed >= 1000, progress: s => `${Math.min(s.stats.handsPlayed,1000)}/1000` },
  { id: 'big_bet', icon: '💰', name: 'High Roller', desc: 'Wager $500 or more on a single hand.',
    check: s => s.stats.biggestSingleBet >= 500 },
  { id: 'big_win', icon: '💎', name: 'Big Score', desc: 'Win $500 or more on a single hand.',
    check: s => s.stats.biggestWin >= 500 },
  { id: 'huge_win', icon: '🌟', name: 'Jackpot Energy', desc: 'Win $2,000 or more on a single hand.',
    check: s => s.stats.biggestWin >= 2000 },
  { id: 'split_master', icon: '🔀', name: 'Splitter', desc: 'Split a hand 10 times total.',
    check: s => s.stats.splitsPlayed >= 10, progress: s => `${Math.min(s.stats.splitsPlayed,10)}/10` },
  { id: 'double_down_fan', icon: '⏫', name: 'Double or Nothing', desc: 'Double down 10 times total.',
    check: s => s.stats.doublesPlayed >= 10, progress: s => `${Math.min(s.stats.doublesPlayed,10)}/10` },
  { id: 'comeback', icon: '🩹', name: 'Comeback Kid', desc: 'Go on a 3+ loss streak, then win 3 in a row.',
    check: s => s.stats.comebackAchieved === true },
  { id: 'five_hands', icon: '🖐️', name: 'Table Hog', desc: 'Play all 5 hands at once in a single round.',
    check: s => s.stats.maxHandsInRound >= 5 },
  { id: 'first_deposit', icon: '🏦', name: 'Topped Up', desc: 'Add funds to your account for the first time.',
    check: s => s.stats.totalAdded > 0 },
  { id: 'net_positive_1000', icon: '📈', name: 'In The Green', desc: 'Reach a lifetime net profit of $1,000.',
    check: s => lifetimeNet(s) >= 1000 },
  { id: 'net_positive_10000', icon: '🥂', name: 'House Killer', desc: 'Reach a lifetime net profit of $10,000.',
    check: s => lifetimeNet(s) >= 10000 },
];

/** Run every achievement check against the state, unlock any newly earned
 *  ones, persist, and return the list of achievement defs unlocked just now. */
function checkAchievements(state){
  const newlyUnlocked = [];
  for (const a of ACHIEVEMENTS){
    if (state.achievements[a.id]) continue;
    let earned = false;
    try { earned = !!a.check(state); } catch (e){ earned = false; }
    if (earned){
      unlockAchievement(state, a.id);
      newlyUnlocked.push(a);
    }
  }
  return newlyUnlocked;
}
