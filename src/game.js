// ゲームエンジン — 有限ステートマシンでゲーム状態を管理
// CLAUDE.md準拠: チップは整数、状態遷移は厳密管理

const GameState = {
  WAITING: 'WAITING',
  PREFLOP: 'PREFLOP',
  FLOP: 'FLOP',
  TURN: 'TURN',
  RIVER: 'RIVER',
  SHOWDOWN: 'SHOWDOWN',
  COMPLETE: 'COMPLETE',
};

const VALID_TRANSITIONS = {
  [GameState.WAITING]: [GameState.PREFLOP],
  [GameState.PREFLOP]: [GameState.FLOP, GameState.SHOWDOWN],
  [GameState.FLOP]: [GameState.TURN, GameState.SHOWDOWN],
  [GameState.TURN]: [GameState.RIVER, GameState.SHOWDOWN],
  [GameState.RIVER]: [GameState.SHOWDOWN],
  [GameState.SHOWDOWN]: [GameState.COMPLETE],
  [GameState.COMPLETE]: [GameState.WAITING],
};

const Action = {
  FOLD: 'fold',
  CHECK: 'check',
  CALL: 'call',
  BET: 'bet',
  RAISE: 'raise',
  ALL_IN: 'all_in',
};

class PokerGame {
  constructor(playerNames, startingChips = 1000, smallBlind = 10) {
    this.smallBlind = smallBlind;
    this.bigBlind = smallBlind * 2;
    this.players = playerNames.map((name, i) => ({
      id: i,
      name,
      chips: startingChips,
      hand: [],
      folded: false,
      currentBet: 0,
      totalBet: 0,
      isAllIn: false,
      hasActed: false,
    }));
    this.dealerIndex = 0;
    this.state = GameState.WAITING;
    this.deck = [];
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.currentPlayerIndex = 0;
    this.lastRaiserIndex = -1;
    this.lastRaiseIncrement = this.bigBlind; // NLH: 直前レイズの増加分（最低レイズ額計算用）
    this.actionLog = [];
    this.lastWinners = [];
    this.lastPot = 0;
  }

  // 状態遷移（不正な遷移は例外）
  transition(newState) {
    if (!VALID_TRANSITIONS[this.state]?.includes(newState)) {
      throw new Error(`不正な状態遷移: ${this.state} → ${newState}`);
    }
    this.state = newState;
  }

  // 新しいハンドを開始
  startHand() {
    this.transition(GameState.PREFLOP);

    // リセット
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.lastRaiseIncrement = this.bigBlind;
    this.actionLog = [];
    this.lastWinners = [];
    this.lastPot = 0;

    for (const p of this.players) {
      p.hand = [];
      p.folded = false;
      p.currentBet = 0;
      p.totalBet = 0;
      p.isAllIn = false;
      p.hasActed = false;
    }

    // バストしたプレイヤーをフォールド扱い
    for (const p of this.players) {
      if (p.chips <= 0) {
        p.folded = true;
      }
    }

    // デッキ作成・シャッフル
    this.deck = shuffleDeck(createDeck());

    // カード配布
    for (const p of this.activePlayers) {
      p.hand = [this.deck.pop(), this.deck.pop()];
    }

    // ブラインド投入
    this.postBlinds();
  }

  get activePlayers() {
    return this.players.filter(p => !p.folded && p.chips > 0);
  }

  get activeInHandPlayers() {
    return this.players.filter(p => !p.folded);
  }

  // startIdx から（含む）最初のチップを持つプレイヤーを探す（デッドボタン用）
  firstActiveFrom(startIdx) {
    const n = this.players.length;
    for (let i = 0; i < n; i++) {
      const idx = (startIdx + i) % n;
      if (this.players[idx].chips > 0) return idx;
    }
    return startIdx; // フォールバック
  }

  // startIdx の次からアクティブなプレイヤーを探す（時計回り）
  firstActiveAfter(startIdx) {
    const n = this.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (startIdx + i) % n;
      const p = this.players[idx];
      if (!p.folded && !p.isAllIn && p.chips > 0) return idx;
    }
    return -1;
  }

  getSBIndex() {
    // ヘッズアップ（チップあり2人）: BTN = SB（先にアクション）
    if (this.activePlayers.length <= 2) {
      return this.firstActiveFrom(this.dealerIndex);
    }
    // デッドボタン方式: ボタンが空席でも次のアクティブプレイヤーへスキップ
    return this.firstActiveFrom((this.dealerIndex + 1) % this.players.length);
  }

  getBBIndex() {
    const sbIdx = this.getSBIndex();
    return this.firstActiveFrom((sbIdx + 1) % this.players.length);
  }

  postBlinds() {
    const sbIdx = this.getSBIndex();
    const bbIdx = this.getBBIndex();
    const sbPlayer = this.players[sbIdx];
    const bbPlayer = this.players[bbIdx];

    const sbAmount = Math.min(this.smallBlind, sbPlayer.chips);
    const bbAmount = Math.min(this.bigBlind, bbPlayer.chips);

    this.placeBet(sbPlayer, sbAmount);
    this.placeBet(bbPlayer, bbAmount);

    this.currentBet = bbAmount;
    this.lastRaiseIncrement = this.bigBlind; // ブラインド後はBBがレイズ基準

    // プリフロップ: UTG（BBの次のアクティブプレイヤー）から
    this.currentPlayerIndex = this.firstActiveAfter(bbIdx);
    this.lastRaiserIndex = bbIdx;

    this.addLog(`${sbPlayer.name}  posts SB  ${this._bb(sbAmount)} BB`);
    this.addLog(`${bbPlayer.name}  posts BB  ${this._bb(bbAmount)} BB`);
  }

  placeBet(player, amount) {
    const actual = Math.min(amount, player.chips);
    player.chips -= actual;
    player.currentBet += actual;
    player.totalBet += actual;
    this.pot += actual;
    if (player.chips === 0) {
      player.isAllIn = true;
    }
    return actual;
  }

  getValidActions(player) {
    if (player.folded || player.isAllIn) return [];

    const actions = [Action.FOLD];
    const toCall = this.currentBet - player.currentBet;

    if (toCall === 0) {
      actions.push(Action.CHECK);
    } else {
      if (player.chips > toCall) {
        actions.push(Action.CALL);
      }
    }

    if (player.chips > toCall) {
      actions.push(toCall === 0 ? Action.BET : Action.RAISE);
    }

    actions.push(Action.ALL_IN);

    return actions;
  }

  performAction(playerIndex, action, amount = 0) {
    const player = this.players[playerIndex];
    if (playerIndex !== this.currentPlayerIndex) {
      throw new Error('このプレイヤーのターンではありません');
    }

    const validActions = this.getValidActions(player);
    if (!validActions.includes(action)) {
      throw new Error(`無効なアクション: ${action}`);
    }

    // amount を安全な非負整数に正規化（NaN / Infinity / 負数によるチップ破壊を防ぐ）
    amount = Number.isFinite(amount) ? Math.floor(Math.max(0, amount)) : 0;

    const toCall = this.currentBet - player.currentBet;

    switch (action) {
      case Action.FOLD:
        player.folded = true;
        this.addLog(`${player.name}  folds`);
        break;

      case Action.CHECK:
        this.addLog(`${player.name}  checks`);
        break;

      case Action.CALL:
        this.placeBet(player, toCall);
        this.addLog(`${player.name}  calls  ${this._bb(toCall)} BB`);
        break;

      case Action.BET: {
        const betAmount = Math.max(this.bigBlind, Math.floor(amount));
        this.placeBet(player, betAmount);
        this.lastRaiseIncrement = player.currentBet; // BET: 増加分 = ベット額全体
        this.currentBet = player.currentBet;
        this.lastRaiserIndex = playerIndex;
        this.resetHasActed(playerIndex);
        this.addLog(`${player.name}  bets  ${this._bb(betAmount)} BB`);
        break;
      }

      case Action.RAISE: {
        // NLH ミニマムレイズ = 直前ベット + 直前レイズ増加分
        const prevTableBet = this.currentBet;
        const minRaiseChips = (prevTableBet + this.lastRaiseIncrement) - player.currentBet;
        const raiseTotal = Math.max(minRaiseChips, Math.floor(amount) + toCall);
        this.placeBet(player, raiseTotal);
        this.lastRaiseIncrement = player.currentBet - prevTableBet; // 実際のレイズ増加分を記録
        this.currentBet = player.currentBet;
        this.lastRaiserIndex = playerIndex;
        this.resetHasActed(playerIndex);
        this.addLog(`${player.name}  raises to  ${this._bb(player.currentBet)} BB`);
        break;
      }

      case Action.ALL_IN: {
        const allInAmount = player.chips;
        this.placeBet(player, allInAmount);
        if (player.currentBet > this.currentBet) {
          this.currentBet = player.currentBet;
          this.lastRaiserIndex = playerIndex;
          this.resetHasActed(playerIndex);
        }
        this.addLog(`${player.name}  ALL IN  ${this._bb(allInAmount)} BB`);
        break;
      }
    }

    player.hasActed = true;

    // 残りプレイヤーチェック
    if (this.checkHandEnd()) return;

    // 次のプレイヤーへ
    this.advanceToNextPlayer();

    // ベッティングラウンド終了チェック
    if (this.isBettingRoundComplete()) {
      this.advanceStreet();
    }
  }

  resetHasActed(exceptIndex) {
    for (const p of this.players) {
      if (p.id !== exceptIndex && !p.folded && !p.isAllIn) {
        p.hasActed = false;
      }
    }
  }

  checkHandEnd() {
    const remaining = this.activeInHandPlayers;
    if (remaining.length === 1) {
      const winner = remaining[0];
      this.lastPot = this.pot;
      this.lastWinners = [winner];
      winner.chips += this.pot;
      this.addLog(`${winner.name}  wins  ${this._bb(this.pot)} BB  (all others fold)`);
      this.pot = 0;
      // FSM 経由で遷移（直接代入は状態チェックをバイパスするため禁止）
      this.transition(GameState.SHOWDOWN);
      this.transition(GameState.COMPLETE);
      return true;
    }
    return false;
  }

  advanceToNextPlayer() {
    let next = (this.currentPlayerIndex + 1) % this.players.length;
    let attempts = 0;
    while (attempts < this.players.length) {
      const p = this.players[next];
      if (!p.folded && !p.isAllIn && p.chips > 0) {
        this.currentPlayerIndex = next;
        return;
      }
      next = (next + 1) % this.players.length;
      attempts++;
    }
    this.currentPlayerIndex = -1;
  }

  skipInactivePlayers() {
    let attempts = 0;
    while (attempts < this.players.length) {
      const p = this.players[this.currentPlayerIndex];
      if (!p.folded && !p.isAllIn && p.chips > 0) return;
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      attempts++;
    }
  }

  isBettingRoundComplete() {
    const eligible = this.players.filter(p => !p.folded && !p.isAllIn);
    if (eligible.length === 0) return true;
    return eligible.every(p => p.hasActed && p.currentBet === this.currentBet);
  }

  advanceStreet() {
    // ストリートごとのベットリセット
    for (const p of this.players) {
      p.currentBet = 0;
      p.hasActed = false;
    }
    this.currentBet = 0;
    this.lastRaiseIncrement = this.bigBlind; // ストリート開始時にリセット

    const canAct = this.players.filter(p => !p.folded && !p.isAllIn);

    switch (this.state) {
      case GameState.PREFLOP:
        this.transition(GameState.FLOP);
        this.deck.pop(); // バーン
        this.communityCards.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
        this.addLog(`── FLOP  ${this.communityCards.map(c => c.display).join(' ')} ──`);
        break;

      case GameState.FLOP:
        this.transition(GameState.TURN);
        this.deck.pop(); // バーン
        this.communityCards.push(this.deck.pop());
        this.addLog(`── TURN  ${this.communityCards.slice(-1)[0].display} ──`);
        break;

      case GameState.TURN:
        this.transition(GameState.RIVER);
        this.deck.pop(); // バーン
        this.communityCards.push(this.deck.pop());
        this.addLog(`── RIVER  ${this.communityCards.slice(-1)[0].display} ──`);
        break;

      case GameState.RIVER:
        this.goToShowdown();
        return;
    }

    // フロップ以降: SB（ディーラーの次のアクティブプレイヤー）から
    // ※全員オールインの場合は firstActiveAfter が -1 を返す → ui.js が runout を制御
    this.currentPlayerIndex = this.firstActiveAfter(this.dealerIndex);
  }

  goToShowdown() {
    this.transition(GameState.SHOWDOWN);

    const contenders = this.activeInHandPlayers;

    // ハンド評価
    for (const p of contenders) {
      const allCards = [...p.hand, ...this.communityCards];
      p.handResult = evaluateHand(allCards);
    }

    // 勝者決定
    const winners = determineWinners(contenders);
    this.lastPot = this.pot;
    this.lastWinners = winners;
    const share = Math.floor(this.pot / winners.length);
    let remainder = this.pot - share * winners.length;

    for (const w of winners) {
      let winAmount = share;
      if (remainder > 0) {
        winAmount += 1;
        remainder--;
      }
      w.chips += winAmount;
    }

    if (winners.length === 1) {
      this.addLog(`${winners[0].name}  wins  ${this._bb(this.pot)} BB  with  ${winners[0].handResult.name}`);
    } else {
      this.addLog(`Split pot — ${winners.map(w => w.name).join(' & ')}  (${winners[0].handResult.name})`);
    }

    this.pot = 0;
    this.transition(GameState.COMPLETE);
  }

  nextHand() {
    // 呼び出し元（ui.js）で state === COMPLETE であることを保証済み
    this.transition(GameState.WAITING);

    // デッドボタン方式: バストした空席も飛ばさず常に1つ進める
    // → ボタンが一周する公平性を保ち、誰かが2回連続でBBを払う状況を防ぐ
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
  }

  _bb(chips) {
    const v = chips / this.bigBlind;
    return Number.isInteger(v) ? `${v}` : v.toFixed(1);
  }

  addLog(message) {
    this.actionLog.push(message);
  }

  getCurrentPlayer() {
    if (this.currentPlayerIndex < 0) return null;
    return this.players[this.currentPlayerIndex];
  }
}
