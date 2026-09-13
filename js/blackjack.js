/* =========================================================
   blackjack.js — multi-hand blackjack game engine (no DOM).
   ui.js drives this and renders the results.
   ========================================================= */

const MAX_HANDS = 5;
const MAX_SPLITS_PER_HAND = 1; // each dealt hand may be split once (2 resulting hands)
const RESHUFFLE_THRESHOLD = 20; // rebuild the shoe when fewer cards remain than this

class BlackjackGame {
  constructor(numDecks = 6){
    this.numDecks = numDecks;
    this.shoe = buildShoe(numDecks);
    this.reset();
  }

  reset(){
    this.phase = 'betting'; // betting | playerTurn | dealerTurn | roundOver
    this.dealerCards = [];
    this.hands = [];
    this.activeHandIndex = -1;
  }

  setDecks(numDecks){
    this.numDecks = numDecks;
  }

  cardsRemaining(){
    return this.shoe.length;
  }

  fullShoeSize(){
    return this.numDecks * 52;
  }

  drawCard(){
    if (this.shoe.length === 0) this.shoe = buildShoe(this.numDecks);
    return this.shoe.pop();
  }

  maybeReshuffle(){
    if (this.shoe.length < RESHUFFLE_THRESHOLD){
      this.shoe = buildShoe(this.numDecks);
      return true;
    }
    return false;
  }

  /** Begin a new round: deal 2 cards to each of `numHands` player hands + dealer. */
  startRound(betPerHand, numHands){
    numHands = Math.max(1, Math.min(MAX_HANDS, numHands));
    const reshuffled = this.maybeReshuffle();

    this.dealerCards = [];
    this.hands = [];
    for (let i = 0; i < numHands; i++){
      this.hands.push(this.makeHand(betPerHand));
    }

    // deal in classic order: one card to each hand, then dealer, twice
    for (let round = 0; round < 2; round++){
      for (const h of this.hands) h.cards.push(this.drawCard());
      this.dealerCards.push(this.drawCard());
    }

    // mark naturals
    for (const h of this.hands){
      if (isBlackjack(h.cards)) h.status = 'blackjack';
    }

    this.phase = 'playerTurn';
    this.activeHandIndex = this.hands.findIndex(h => h.status === 'active');

    // If every hand is already a natural blackjack, skip straight to dealer turn.
    if (this.activeHandIndex === -1) this.phase = 'dealerTurn';

    return { reshuffled };
  }

  makeHand(bet){
    return {
      cards: [],
      bet,
      originalBet: bet,
      status: 'active', // active | stood | bust | blackjack
      isSplitHand: false,
      isDoubled: false,
      isSplitAces: false,
      splitsUsed: 0,
      net: 0,
      outcome: null,
    };
  }

  activeHand(){
    return this.activeHandIndex >= 0 ? this.hands[this.activeHandIndex] : null;
  }

  canHit(hand){
    return hand && hand.status === 'active' && !hand.isSplitAces;
  }

  canDouble(hand){
    return hand && hand.status === 'active' && hand.cards.length === 2 && !hand.isSplitAces;
  }

  canSplit(hand){
    if (!hand || hand.status !== 'active') return false;
    if (hand.cards.length !== 2) return false;
    if (hand.splitsUsed >= MAX_SPLITS_PER_HAND) return false;
    return hand.cards[0].value === hand.cards[1].value;
  }

  hit(){
    const hand = this.activeHand();
    if (!this.canHit(hand)) return;
    hand.cards.push(this.drawCard());
    const total = handValue(hand.cards);
    if (total > 21){
      hand.status = 'bust';
      this.advanceTurn();
    } else if (total === 21){
      hand.status = 'stood';
      this.advanceTurn();
    }
  }

  stand(){
    const hand = this.activeHand();
    if (!hand || hand.status !== 'active') return;
    hand.status = 'stood';
    this.advanceTurn();
  }

  double(){
    const hand = this.activeHand();
    if (!this.canDouble(hand)) return;
    hand.bet *= 2;
    hand.isDoubled = true;
    hand.cards.push(this.drawCard());
    hand.status = handValue(hand.cards) > 21 ? 'bust' : 'stood';
    this.advanceTurn();
  }

  split(){
    const hand = this.activeHand();
    if (!this.canSplit(hand)) return;

    const newHand = this.makeHand(hand.originalBet);
    newHand.isSplitHand = true;
    newHand.splitsUsed = hand.splitsUsed + 1;
    newHand.cards = [hand.cards.pop()];

    hand.isSplitHand = true;
    hand.splitsUsed += 1;

    const wasAces = hand.cards[0].rank === 'A';
    if (wasAces){
      hand.isSplitAces = true;
      newHand.isSplitAces = true;
    }

    hand.cards.push(this.drawCard());
    newHand.cards.push(this.drawCard());

    if (wasAces){
      // split aces: one card each, then both immediately stand
      hand.status = 'stood';
      newHand.status = 'stood';
    } else if (handValue(hand.cards) === 21){
      hand.status = 'stood';
    }

    this.hands.splice(this.activeHandIndex + 1, 0, newHand);

    if (hand.status !== 'active'){
      this.advanceTurn();
    }
  }

  /** Move to the next hand with status 'active'; if none remain, go to dealer turn. */
  advanceTurn(){
    for (let i = this.activeHandIndex + 1; i < this.hands.length; i++){
      if (this.hands[i].status === 'active'){
        this.activeHandIndex = i;
        return;
      }
    }
    this.activeHandIndex = -1;
    this.phase = 'dealerTurn';
    this.playDealer();
  }

  /** Dealer draws until 17+. Skipped entirely if every player hand already lost (all bust). */
  playDealer(){
    const anyLive = this.hands.some(h => h.status !== 'bust');
    if (anyLive){
      while (handValue(this.dealerCards) < 17){
        this.dealerCards.push(this.drawCard());
      }
    }
    this.settle();
  }

  settle(){
    const dealerTotal = handValue(this.dealerCards);
    const dealerBust = dealerTotal > 21;
    const dealerBlackjack = isBlackjack(this.dealerCards);

    for (const h of this.hands){
      const playerTotal = handValue(h.cards);

      if (h.status === 'bust'){
        h.outcome = 'loss';
        h.net = -h.bet;
        continue;
      }

      if (h.status === 'blackjack'){
        if (dealerBlackjack){
          h.outcome = 'push';
          h.net = 0;
        } else {
          h.outcome = 'blackjack';
          h.net = Math.round(h.bet * 1.5);
        }
        continue;
      }

      // stood
      if (dealerBlackjack){
        h.outcome = 'loss';
        h.net = -h.bet;
      } else if (dealerBust || playerTotal > dealerTotal){
        h.outcome = 'win';
        h.net = h.bet;
      } else if (playerTotal === dealerTotal){
        h.outcome = 'push';
        h.net = 0;
      } else {
        h.outcome = 'loss';
        h.net = -h.bet;
      }
    }

    this.phase = 'roundOver';
  }

  /** Summarize the finished round for storage.recordRound(). */
  buildRoundResult(){
    const hands = this.hands.map(h => ({
      bet: h.bet,
      outcome: h.outcome,
      net: h.net,
      wasSplit: h.isSplitHand,
      wasDouble: h.isDoubled,
      wasBust: h.status === 'bust',
    }));
    const totalWagered = hands.reduce((s, h) => s + h.bet, 0);
    const netResult = hands.reduce((s, h) => s + h.net, 0);
    return { numHands: hands.length, totalWagered, netResult, hands };
  }
}
