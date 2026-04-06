// ハンド評価エンジン
// 7枚のカードから最強の5枚の組み合わせを判定する
// CLAUDE.md準拠: ハンドランク10段階、キッカー比較対応

const HandRank = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9,
};

const HandRankNames = {
  [HandRank.HIGH_CARD]: 'ハイカード',
  [HandRank.ONE_PAIR]: 'ワンペア',
  [HandRank.TWO_PAIR]: 'ツーペア',
  [HandRank.THREE_OF_A_KIND]: 'スリーオブアカインド',
  [HandRank.STRAIGHT]: 'ストレート',
  [HandRank.FLUSH]: 'フラッシュ',
  [HandRank.FULL_HOUSE]: 'フルハウス',
  [HandRank.FOUR_OF_A_KIND]: 'フォーオブアカインド',
  [HandRank.STRAIGHT_FLUSH]: 'ストレートフラッシュ',
  [HandRank.ROYAL_FLUSH]: 'ロイヤルフラッシュ',
};

// 5枚の組み合わせを全て生成（7C5 = 21通り）
function getCombinations(cards, k) {
  const results = [];
  function combine(start, combo) {
    if (combo.length === k) {
      results.push([...combo]);
      return;
    }
    for (let i = start; i < cards.length; i++) {
      combo.push(cards[i]);
      combine(i + 1, combo);
      combo.pop();
    }
  }
  combine(0, []);
  return results;
}

// 5枚のカードのハンドランクを評価
function evaluate5Cards(cards) {
  const sorted = [...cards].sort((a, b) => b.value - a.value);
  const values = sorted.map(c => c.value);
  const suits = sorted.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);

  // ストレート判定（A-2-3-4-5 と 10-J-Q-K-A を考慮）
  let isStraight = false;
  let straightHigh = values[0];

  // 通常のストレート
  if (values[0] - values[4] === 4 && new Set(values).size === 5) {
    isStraight = true;
  }
  // A-2-3-4-5（ホイール）
  if (values[0] === 12 && values[1] === 3 && values[2] === 2 && values[3] === 1 && values[4] === 0) {
    isStraight = true;
    straightHigh = 3; // 5がハイ
  }

  // ランクごとの枚数カウント
  const rankCount = {};
  for (const v of values) {
    rankCount[v] = (rankCount[v] || 0) + 1;
  }
  const counts = Object.entries(rankCount)
    .map(([v, c]) => ({ value: parseInt(v), count: c }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  // ロイヤルフラッシュ
  if (isFlush && isStraight && straightHigh === 12) {
    return { rank: HandRank.ROYAL_FLUSH, kickers: [12] };
  }
  // ストレートフラッシュ
  if (isFlush && isStraight) {
    return { rank: HandRank.STRAIGHT_FLUSH, kickers: [straightHigh] };
  }
  // フォーオブアカインド
  if (counts[0].count === 4) {
    return {
      rank: HandRank.FOUR_OF_A_KIND,
      kickers: [counts[0].value, counts[1].value],
    };
  }
  // フルハウス
  if (counts[0].count === 3 && counts[1].count === 2) {
    return {
      rank: HandRank.FULL_HOUSE,
      kickers: [counts[0].value, counts[1].value],
    };
  }
  // フラッシュ
  if (isFlush) {
    return { rank: HandRank.FLUSH, kickers: values };
  }
  // ストレート
  if (isStraight) {
    return { rank: HandRank.STRAIGHT, kickers: [straightHigh] };
  }
  // スリーオブアカインド
  if (counts[0].count === 3) {
    return {
      rank: HandRank.THREE_OF_A_KIND,
      kickers: [counts[0].value, counts[1].value, counts[2].value],
    };
  }
  // ツーペア
  if (counts[0].count === 2 && counts[1].count === 2) {
    return {
      rank: HandRank.TWO_PAIR,
      kickers: [counts[0].value, counts[1].value, counts[2].value],
    };
  }
  // ワンペア
  if (counts[0].count === 2) {
    return {
      rank: HandRank.ONE_PAIR,
      kickers: [counts[0].value, counts[1].value, counts[2].value, counts[3].value],
    };
  }
  // ハイカード
  return { rank: HandRank.HIGH_CARD, kickers: values };
}

// 7枚のカードから最強のハンドを評価
function evaluateHand(cards) {
  const combos = getCombinations(cards, 5);
  let best = null;
  let bestCards = null;

  for (const combo of combos) {
    const result = evaluate5Cards(combo);
    if (!best || compareResults(result, best) > 0) {
      best = result;
      bestCards = combo;
    }
  }

  return { ...best, name: HandRankNames[best.rank], bestCards };
}

// 2つの評価結果を比較（正: aが強い、負: bが強い、0: 同等）
function compareResults(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.min(a.kickers.length, b.kickers.length); i++) {
    if (a.kickers[i] !== b.kickers[i]) return a.kickers[i] - b.kickers[i];
  }
  return 0;
}

// 複数プレイヤーの中から勝者を決定（複数勝者=スプリットポット対応）
function determineWinners(players) {
  let bestResult = null;
  let winners = [];

  for (const player of players) {
    const cmp = bestResult ? compareResults(player.handResult, bestResult) : 1;
    if (cmp > 0) {
      bestResult = player.handResult;
      winners = [player];
    } else if (cmp === 0) {
      winners.push(player);
    }
  }

  return winners;
}
