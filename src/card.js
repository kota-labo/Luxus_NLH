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
// rejection sampling でモジュロバイアスを除去する
// （`rand % n` は 2^32 が n で割り切れない場合に偏りが生じるため）
function shuffleDeck(deck) {
  const shuffled = [...deck];
  const rng = new Uint32Array(1);

  for (let i = shuffled.length - 1; i > 0; i--) {
    const limit = i + 1;
    // [0, limit) の均等分布を保証するため、バイアスが生じる上限値以上は棄却する
    // threshold = floor(2^32 / limit) * limit — これ以上の値は剰余が偏る
    const threshold = 0x100000000 - (0x100000000 % limit);
    let r;
    do {
      crypto.getRandomValues(rng);
      r = rng[0];
    } while (r >= threshold); // 棄却率は最大 limit/2^32 ≈ 0.0000012% (limit≦52)
    const j = r % limit;
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
