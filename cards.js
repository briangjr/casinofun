/* =========================================================
   cards.js — shoe / deck engine + realistic card rendering
   ========================================================= */

const SUITS = [
  { key: 'S', symbol: '♠', color: 'black' },
  { key: 'H', symbol: '♥', color: 'red' },
  { key: 'D', symbol: '♦', color: 'red' },
  { key: 'C', symbol: '♣', color: 'black' },
];

const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

// Classic pip layouts as {x%, y%, flip} — flip rotates the pip 180° so the
// bottom half of the card reads correctly right-side-up when the card is turned.
const PIP_LAYOUTS = {
  '2': [ [50,20,false], [50,80,true] ],
  '3': [ [50,18,false], [50,50,false], [50,82,true] ],
  '4': [ [25,18,false],[75,18,false],[25,82,true],[75,82,true] ],
  '5': [ [25,18,false],[75,18,false],[50,50,false],[25,82,true],[75,82,true] ],
  '6': [ [25,18,false],[75,18,false],[25,50,false],[75,50,false],[25,82,true],[75,82,true] ],
  '7': [ [25,18,false],[75,18,false],[50,34,false],[25,50,false],[75,50,false],[25,82,true],[75,82,true] ],
  '8': [ [25,15,false],[75,15,false],[50,30,false],[25,45,false],[75,45,false],[50,60,true],[25,85,true],[75,85,true] ],
  '9': [ [25,14,false],[75,14,false],[25,37,false],[75,37,false],[50,50,false],[25,63,true],[75,63,true],[25,86,true],[75,86,true] ],
  '10':[ [25,12,false],[75,12,false],[50,24,false],[25,37,false],[75,37,false],[25,63,true],[75,63,true],[50,76,true],[25,88,true],[75,88,true] ],
};

const FACE_ICON = { J: '⚔️', Q: '👑', K: '👑' };

function rankValue(rank){
  if (rank === 'A') return 11;
  if (['J','Q','K'].includes(rank)) return 10;
  return parseInt(rank, 10);
}

/** Build a shoe of `numDecks` standard 52-card decks, shuffled. */
function buildShoe(numDecks){
  const shoe = [];
  for (let d = 0; d < numDecks; d++){
    for (const suit of SUITS){
      for (const rank of RANKS){
        shoe.push({ rank, suit: suit.key, symbol: suit.symbol, color: suit.color, value: rankValue(rank) });
      }
    }
  }
  return shuffle(shoe);
}

function shuffle(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Render a card object into a DOM element. faceDown=true shows the card back. */
function renderCard(card, faceDown = false){
  const el = document.createElement('div');
  el.className = 'card';

  if (faceDown){
    el.classList.add('face-down');
    return el;
  }

  el.classList.add(card.color);

  const cornerTL = document.createElement('div');
  cornerTL.className = 'card-corner top-left';
  cornerTL.innerHTML = `<span>${card.rank}</span><span class="corner-suit">${card.symbol}</span>`;
  el.appendChild(cornerTL);

  // Bottom-right index is only useful on a fully-exposed card; in a fanned
  // hand it would sit under the next card, so it's added by ui.js only for
  // the last card currently visible in a row (see markLastCard()).
  const cornerBR = document.createElement('div');
  cornerBR.className = 'card-corner bottom-right';
  cornerBR.innerHTML = `<span>${card.rank}</span><span class="corner-suit">${card.symbol}</span>`;
  el.appendChild(cornerBR);
  el.dataset.rank = card.rank;

  if (card.rank === 'A'){
    const pips = document.createElement('div');
    pips.className = 'card-pips';
    pips.innerHTML = `<span class="pip ace" style="left:50%;top:50%;">${card.symbol}</span>`;
    el.appendChild(pips);
  } else if (['J','Q','K'].includes(card.rank)){
    const portrait = document.createElement('div');
    portrait.className = 'face-portrait';
    portrait.innerHTML = `
      <span class="face-icon">${FACE_ICON[card.rank]}</span>
      <span class="face-letter">${card.rank}</span>
      <span class="face-icon">${card.symbol}</span>
    `;
    el.appendChild(portrait);
  } else {
    const pips = document.createElement('div');
    pips.className = 'card-pips';
    const layout = PIP_LAYOUTS[card.rank] || [];
    pips.innerHTML = layout.map(([x,y,flip]) =>
      `<span class="pip${flip ? ' flip' : ''}" style="left:${x}%;top:${y}%;">${card.symbol}</span>`
    ).join('');
    el.appendChild(pips);
  }

  return el;
}

/** Sum a hand's value, treating Aces as 11 or 1 to avoid busting where possible. */
function handValue(cards){
  let total = 0;
  let aces = 0;
  for (const c of cards){
    total += c.value;
    if (c.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0){
    total -= 10;
    aces--;
  }
  return total;
}

function isBlackjack(cards){
  return cards.length === 2 && handValue(cards) === 21;
}
