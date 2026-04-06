// カードとデッキの定義
// CLAUDE.md準拠: 暗号学的乱数を使用、Math.random()は使用禁止

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
const SUIT_SYMBOLS = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function createCard(rank, suit) {
  return {
    rank,
    suit,
    value: RANKS.indexOf(rank),
    display: `${rank}${SUIT_SYMBOLS[suit]}`,
    isRed: suit === 'hearts' || suit === 'diamonds',
  };
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(createCard(rank, suit));
    }
  }
  return deck;
}

// 暗号学的乱数によるFisher-Yatesシャッフル
function shuffleDeck(deck) {
  const shuffled = [...deck];
  const randomBytes = new Uint32Array(shuffled.length);
  crypto.getRandomValues(randomBytes);

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomBytes[i] % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
