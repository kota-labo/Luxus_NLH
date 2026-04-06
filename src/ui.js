// UIコントローラー v12 — Luxu's Poker

let game = null;
const BB = 10;

// デスクトップ座席配置（テーブル外に十分余裕を持たせてカード重複を防ぐ）
const SEATS = {
  2: [[50,89],[50,10]],
  3: [[50,89],[14,22],[86,22]],
  4: [[50,89],[11,50],[50,10],[89,50]],
  5: [[50,89],[11,63],[20,17],[80,17],[89,63]],
  6: [[50,89],[11,64],[17,15],[50,10],[83,15],[89,64]],
};

// スマホ縦向き (≤500px) 専用の座席配置
// table-viewport 460px、テーブル: 255×320px縦楕円、中心(50%,50%)=(187.5px,230px)
// 座席楕円: a_seat=36%(≈135px), b_seat=38%(≈175px) (テーブルリムより外側)
// プレイヤーを各人数で楕円上に均等配置（θ=90°=下=自分から時計回り）
const MOBILE_SEATS = {
  2: [[50,83],[50,16]],
  3: [[50,83],[14,32],[86,32]],
  4: [[50,83],[14,50],[50,16],[86,50]],
  5: [[50,83],[15,63],[29,20],[71,20],[85,63]],
  6: [[50,83],[18,68],[18,32],[50,16],[82,32],[82,68]],
};
const COLORS = ['#1e88e5','#8e24aa','#00897b','#e53935','#fb8c00','#43a047'];

// ポジションラベル（ディーラーからの距離順）
const POS_LABELS = {
  2: ['BTN','BB'],
  3: ['BTN','SB','BB'],
  4: ['BTN','SB','BB','UTG'],
  5: ['BTN','SB','BB','UTG','CO'],
  6: ['BTN','SB','BB','UTG','HJ','CO'],
};
function getPos(playerIdx) {
  const n    = game.players.length;
  const dist = (playerIdx - game.dealerIndex + n) % n;
  return (POS_LABELS[n] || POS_LABELS[6])[dist] || '';
}
let mobileRaiseAmount = 0;  // モバイルレイズ選択額（chips）
let mobileCustomMode  = false; // カスタム入力モード

let lastActions = {};
let lastActorId = -1;   // 直前にアクションしたプレイヤーのid（そのプレイヤーのみバブル表示）
let prevStreet  = null;
let lastAnimatedStreet = null; // フロップ等のカードアニメ管理

const SUIT_SYM = { spades:'♠', hearts:'♥', diamonds:'♦', clubs:'♣' };

function cardHtml(c, size) {
  const colorCls = c.isRed ? 'red' : 'blk';
  return `<span class="card ${size} ${colorCls} ${sc(c)}"><span class="c-rank">${c.rank}</span><span class="c-suit">${SUIT_SYM[c.suit]}</span></span>`;
}

function bb(chips) {
  const v = chips / BB;
  return Number.isInteger(v) ? `${v}` : v.toFixed(1);
}

// XSS対策: innerHTML に挿入する文字列をすべてエスケープ
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ------- セットアップ -------
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.player-num').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.player-num').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
});

function initGame() {
  const raw = parseInt(document.querySelector('.player-num.selected')?.dataset.val);
  const n = Number.isFinite(raw) ? Math.max(2, Math.min(6, raw)) : 4;
  const names = ['You','Alice','Bob','Carol','Dave','Eve'].slice(0, n);
  game = new PokerGame(names, 100 * BB, BB / 2);
  lastActions = {}; lastActorId = -1; prevStreet = null;
  document.getElementById('setup-screen').classList.add('hidden');
  document.getElementById('game-screen').classList.remove('hidden');
  startNewHand();
}

// ------- ハンド開始 -------
function startNewHand() {
  const ov = document.getElementById('win-overlay');
  if (ov) ov.classList.add('hidden');
  if (game.state === GameState.COMPLETE) game.nextHand();
  lastActions = {}; lastActorId = -1; prevStreet = null; lastAnimatedStreet = null;
  mobileRaiseAmount = 0; mobileCustomMode = false;

  const alive = game.players.filter(p => p.chips > 0);
  if (alive.length <= 1) {
    const w = alive[0] || game.players[0];
    game.addLog(`${w.name} wins the game!`);
    renderAll();
    const el = document.getElementById('actions');
    el.innerHTML = '';
    const bar = mkBar();
    const b = mkBtn('deal', 'BACK TO MENU'); b.onclick = backToSetup;
    bar.appendChild(b); el.appendChild(bar);
    return;
  }
  game.startHand(); renderAll();
  if (isRunout()) { scheduleRunout(); return; }
  if (game.currentPlayerIndex !== 0 && game.state !== GameState.COMPLETE)
    setTimeout(cpuTurn, 800);
}

// ------- テーマ -------
function toggleThemeMenu() {
  const menu = document.getElementById('theme-menu');
  menu.classList.toggle('hidden');
  _syncActive();
  if (!menu.classList.contains('hidden'))
    setTimeout(() => document.addEventListener('click', _closeOut, { once: true }), 0);
}
function _syncActive() {
  const t  = document.documentElement.getAttribute('data-theme') || 'classic';
  const c  = document.documentElement.getAttribute('data-card')  || 'blue';
  const bg = document.documentElement.getAttribute('data-bg')    || 'default';
  document.querySelectorAll('.theme-opt').forEach(b => b.classList.toggle('active', b.dataset.theme === t));
  document.querySelectorAll('.card-theme-btn').forEach(b => b.classList.toggle('active', b.dataset.card === c));
  document.querySelectorAll('.bg-opt').forEach(b => b.classList.toggle('active', b.dataset.bg === bg));
}
function _closeOut(e) {
  const wrap = document.querySelector('.theme-wrap');
  if (wrap && !wrap.contains(e.target)) document.getElementById('theme-menu').classList.add('hidden');
}
function setTheme(name) {
  document.documentElement.setAttribute('data-theme', name);
  document.querySelectorAll('.theme-opt').forEach(b => b.classList.toggle('active', b.dataset.theme === name));
  document.getElementById('theme-menu').classList.add('hidden');
}
function setCardTheme(name) {
  document.documentElement.setAttribute('data-card', name);
  document.querySelectorAll('.card-theme-btn').forEach(b => b.classList.toggle('active', b.dataset.card === name));
  document.getElementById('theme-menu').classList.add('hidden');
  if (game) renderPlayers();
}
function setBgTheme(name) {
  document.documentElement.setAttribute('data-bg', name || 'default');
  document.querySelectorAll('.bg-opt').forEach(b => b.classList.toggle('active', b.dataset.bg === (name || 'default')));
  document.getElementById('theme-menu').classList.add('hidden');
}

// ------- スーツクラス -------
function sc(card) { return `suit-${card.suit}`; }

// ------- アクション定義 -------
const ACTION_LABELS = {
  [Action.FOLD]:   { label:'FOLD',   type:'fold'  },
  [Action.CHECK]:  { label:'CHECK',  type:'check' },
  [Action.CALL]:   { label:'CALL',   type:'call'  },
  [Action.BET]:    { label:'BET',    type:'bet'   },
  [Action.RAISE]:  { label:'RAISE',  type:'raise' },
  [Action.ALL_IN]: { label:'ALL IN', type:'allin' },
};

// ------- レイズプリセット計算（total = テーブル上の合計） -------
// ポット計算公式: X%ポットサイズレイズ = X%×(2×bet + pot) + bet
function potSizeTotal(frac, bet, pot) {
  return Math.round(frac * (2 * bet + pot) + bet);
}

function computeRaisePresets(player) {
  const toCall = game.currentBet - player.currentBet;
  const isRaise = toCall > 0;
  const raiseAct = isRaise ? Action.RAISE : Action.BET;
  // minTotal / maxTotal はテーブル上に出す合計（player.currentBet 後の値）
  const minTotal = isRaise ? game.currentBet + game.lastRaiseIncrement : game.bigBlind;
  const maxTotal = isRaise ? player.chips + player.currentBet : player.chips;
  const pot = game.pot;
  const bet = game.currentBet; // 現在のテーブルベット額

  // プリフロップ初回レイズ: 2BB/2.3BB/2.5BB/3BB
  const isPreflopFirst = game.state === GameState.PREFLOP && game.currentBet <= game.bigBlind;
  const rawCandidates = isPreflopFirst
    ? [
        { label:'2BB',   total: 2   * game.bigBlind },
        { label:'2.3BB', total: 23 },   // 2.3×10
        { label:'2.5BB', total: 25 },   // 2.5×10
        { label:'3BB',   total: 3   * game.bigBlind },
      ]
    : [
        { label:'33%',  total: potSizeTotal(0.33, bet, pot) },
        { label:'50%',  total: potSizeTotal(0.5,  bet, pot) },
        { label:'100%', total: potSizeTotal(1.0,  bet, pot) },
      ];

  const seen = new Set();
  const presets = [];
  for (const r of rawCandidates) {
    const t = Math.max(minTotal, Math.min(maxTotal, r.total));
    if (t >= minTotal && !seen.has(t)) {
      seen.add(t);
      // game.performAction に渡す amount: RAISE は追加分、BET はそのまま合計
      const amount = isRaise ? t - game.currentBet : t;
      presets.push({ label: r.label, total: t, amount });
    }
  }
  return { presets, minTotal, maxTotal, raiseAct };
}

// ------- レンダリング -------
function renderAll() {
  if (game.state !== prevStreet) {
    if (prevStreet !== null) { lastActions = {}; lastActorId = -1; }
    prevStreet = game.state;
  }
  renderPlayers();
  renderCommunityCards();
  renderPotInfo();
  renderActions();
  renderLog();
  renderWinOverlay();
}

// ------- 勝利オーバーレイ -------
function renderWinOverlay() {
  const overlay = document.getElementById('win-overlay');
  if (!overlay) return;
  if (game.state !== GameState.COMPLETE || !game.lastWinners || game.lastWinners.length === 0) {
    overlay.classList.add('hidden'); return;
  }
  const winners = game.lastWinners;
  const isMulti = winners.length > 1;
  document.getElementById('win-player-name').textContent =
    isMulti ? winners.map(w => w.name.toUpperCase()).join(' & ') : winners[0].name.toUpperCase();
  document.getElementById('win-hand-name').textContent =
    winners[0].handResult ? winners[0].handResult.name : '';
  document.getElementById('win-pot').textContent =
    `+ ${bb(game.lastPot)} BB`;
  overlay.classList.remove('hidden');
}

function renderPlayers() {
  const el  = document.getElementById('players');
  el.innerHTML = '';
  const isMobile = window.innerWidth <= 500;
  const seatMap  = isMobile ? MOBILE_SEATS : SEATS;
  const pos      = seatMap[game.players.length] || seatMap[6];

  game.players.forEach((p, i) => {
    const isDlr    = i === game.dealerIndex;
    const isSB     = i === game.getSBIndex();
    const isBB     = i === game.getBBIndex();
    const isActive = i === game.currentPlayerIndex && game.state !== GameState.COMPLETE;
    const isHuman  = i === 0;
    const isSD     = game.state === GameState.SHOWDOWN || game.state === GameState.COMPLETE;

    const seat = document.createElement('div');
    // オールイン中はバスト扱いにしない（チップ0でもアクティブ表示）
    seat.className = `seat${isActive?' seat-active':''}${p.folded?' seat-folded':''}${p.chips<=0&&!p.isAllIn?' seat-bust':''}${isHuman?' seat-you':''}`;
    seat.style.left = pos[i][0] + '%';
    seat.style.top  = pos[i][1] + '%';

    // ポジションチップ（SB/BBのみ座席に表示。Dはテーブル上に別途描画）
    const posChip = isSB ? '<div class="pos-chip bsb">SB</div>'
                  : isBB ? '<div class="pos-chip bbb">BB</div>'
                  : '';

    // ホールカード（フォールド済みも裏向きで残す / ランアウト中・ショーダウンは全公開）
    const showFaceUp = isHuman || isSD || isRunout();
    let cards = '';
    if (p.hand.length) {
      if (p.folded) {
        // フォールド: 自分は表向き、CPUは裏向きで薄く残す（seat-folded の opacity で減光）
        if (isHuman) {
          cards = p.hand.map(c => cardHtml(c, 'hole')).join('');
        } else {
          cards = '<span class="card hole bk"></span><span class="card hole bk"></span>';
        }
      } else if (showFaceUp) {
        cards = p.hand.map(c => cardHtml(c, 'hole')).join('');
      } else {
        cards = '<span class="card hole bk"></span><span class="card hole bk"></span>';
      }
    }

    const hname  = isSD && p.handResult && !p.folded ? `<span class="hname">${p.handResult.name}</span>` : '';
    const stt    = p.folded   ? '<span class="stt stt-fold">FOLD</span>'
                 : p.isAllIn  ? '<span class="stt stt-allin">ALL IN</span>'
                 : p.chips<=0 ? '<span class="stt stt-bust">BUST</span>' : '';

    // アクションバブル：全プレイヤーの直近アクションを残す（ストリート切替でリセット）
    const la     = lastActions[i];
    const isNew  = (i === lastActorId);
    const bubble = (la && !isSD)
      ? `<div class="action-bubble ab-${la.type}${isNew?' ab-new':''}">${la.label}</div>` : '';
    const arrow  = isActive ? '<span class="turn-arrow">▶</span>' : '';

    const posLbl  = getPos(i);
    // モバイルはベット額をシート内に表示（table-bet-chip は非表示）
    const pcbetHtml = isMobile && p.currentBet > 0
      ? `<span class="pcbet">${bb(p.currentBet)} BB</span>` : '';
    seat.innerHTML = `
      ${arrow}
      <div class="cards-row">${cards}</div>
      ${bubble}
      ${posChip}
      <div class="seat-pill">
        <div class="av" style="background:${COLORS[i]}">${esc(p.name[0])}</div>
        <div class="pos-label pos-${posLbl.toLowerCase()}">${posLbl}</div>
        <div class="pinfo">
          <span class="pname">${esc(p.name)}</span>
          <span class="pstack">${bb(p.chips)} BB</span>
          ${pcbetHtml}
        </div>
      </div>
      ${hname}${stt}
    `;
    el.appendChild(seat);

    // ベットチップをテーブル上（座席とポットの中間）に配置（デスクトップのみ）
    if (!isMobile && p.currentBet > 0) {
      const tchip = document.createElement('div');
      tchip.className = 'table-bet-chip';
      // 座席位置からテーブル中央(50,50)へ55%引き寄せた位置
      tchip.style.left = (pos[i][0] * 0.45 + 50 * 0.55) + '%';
      tchip.style.top  = (pos[i][1] * 0.45 + 50 * 0.55) + '%';
      tchip.innerHTML  = `<span class="chip-dot"></span>${bb(p.currentBet)} BB`;
      el.appendChild(tchip);
    }
  });

  // ディーラーボタンをテーブル上に配置
  const dPos = pos[game.dealerIndex];
  const dbtn = document.createElement('div');
  dbtn.className = 'dealer-btn-chip';
  // 座席位置からテーブル中央(50,50)へ30%引き寄せた位置（テーブルリム上）
  // 2人テーブルは上下中央線上に集中するためDボタンを横にオフセット
  const dLeftBase = dPos[0] * 0.70 + 50 * 0.30;
  const dOffset   = dPos[1] >= 60 ? 12 : 0;
  dbtn.style.left = (dLeftBase + dOffset) + '%';
  dbtn.style.top  = (dPos[1] * 0.70 + 50 * 0.30) + '%';
  dbtn.textContent = 'D';
  el.appendChild(dbtn);
}

function renderCommunityCards() {
  const el = document.getElementById('community-cards');

  // 新しいストリートのカードかどうかを検知（1回目のみアニメ付き）
  const isNewStreet = game.communityCards.length > 0 &&
    game.state !== lastAnimatedStreet &&
    (game.state === GameState.FLOP || game.state === GameState.TURN || game.state === GameState.RIVER);
  if (isNewStreet) lastAnimatedStreet = game.state;

  el.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const c = game.communityCards[i];
    if (c) {
      el.insertAdjacentHTML('beforeend', cardHtml(c, 'comm'));
    } else {
      const ph = document.createElement('span');
      ph.className = 'card comm ph';
      el.appendChild(ph);
    }
  }

  // 新カードにstaggerアニメを付与
  if (isNewStreet) {
    // フロップは3枚全て、ターン/リバーは最後の1枚だけ
    const newStart = game.state === GameState.FLOP ? 0 : game.communityCards.length - 1;
    el.querySelectorAll('.card.comm:not(.ph)').forEach((card, i) => {
      if (i >= newStart) {
        card.style.animationDelay = (game.state === GameState.FLOP ? (i - newStart) * 0.3 : 0) + 's';
        card.classList.add('card-new');
      }
    });
  }
}

function renderPotInfo() {
  // COMPLETE時はlastPotを表示（pot=0になるが最終ポット額を残す）
  const potAmt = (game.state === GameState.COMPLETE && game.lastPot > 0)
    ? game.lastPot : game.pot;
  document.getElementById('pot-display').textContent = `POT  ${bb(potAmt)} BB`;
  document.getElementById('street-display').textContent = game.state;
}

// ------- ヘルパー -------
function mkBar()     { const d=document.createElement('div'); d.className='action-bar'; return d; }
function mkGroup()   { const d=document.createElement('div'); d.className='action-group'; return d; }
function mkDivider() { const d=document.createElement('div'); d.className='action-divider'; return d; }
function mkBtn(cls, html) {
  const b = document.createElement('button');
  b.className = `action-btn ${cls}`;
  b.innerHTML = html; return b;
}
function mkActionBar() {
  return mkBar();
}

// ------- モバイルチップ生成 -------
function buildMobileChips(minTotal, maxTotal) {
  const pot = game.pot;
  const vals = new Set();
  // BBインクリメントでminから最大20ステップ
  for (let v = minTotal, c = 0; v <= maxTotal && c < 20; v += BB, c++) vals.add(v);
  // ポット倍率の主要値（33%/50%/100%）
  for (const frac of [0.33, 0.5, 1.0]) {
    const clamped = Math.max(minTotal, Math.min(maxTotal, Math.round(pot * frac / BB) * BB));
    if (clamped >= minTotal && clamped <= maxTotal) vals.add(clamped);
  }
  vals.add(maxTotal); // 常にオールインを含む
  return [...vals].sort((a, b) => a - b);
}

// ------- モバイルアクション (≤500px) -------
function renderMobileActions() {
  const el = document.getElementById('actions');
  el.innerHTML = '';

  // ── オールインランアウト ──
  if (isRunout()) {
    const wrap = document.createElement('div');
    wrap.className = 'mobile-action-wrap mob-simple-wrap';
    const msg = document.createElement('span');
    msg.className = 'waiting-msg'; msg.textContent = 'ALL IN — RUNOUT';
    wrap.appendChild(msg);
    el.appendChild(wrap); return;
  }

  // ── SHOWDOWN / COMPLETE ──
  if (game.state === GameState.COMPLETE || game.state === GameState.SHOWDOWN) {
    const wrap = document.createElement('div');
    wrap.className = 'mobile-action-wrap mob-simple-wrap';
    const b = document.createElement('button');
    b.className = 'mob-btn mob-deal'; b.textContent = 'NEXT HAND'; b.onclick = startNewHand;
    wrap.appendChild(b);
    el.appendChild(wrap); return;
  }

  const p = game.players[0];

  // ── フォールド済み（CPU続行） ──
  if (p.folded && game.currentPlayerIndex !== 0) {
    const wrap = document.createElement('div');
    wrap.className = 'mobile-action-wrap mob-simple-wrap';
    const b = document.createElement('button');
    b.className = 'mob-btn mob-deal'; b.textContent = 'NEXT HAND'; b.onclick = fastForwardHand;
    wrap.appendChild(b);
    el.appendChild(wrap);
    if (game.state !== GameState.COMPLETE && game.state !== GameState.SHOWDOWN)
      setTimeout(cpuTurn, 550);
    return;
  }

  // ── CPU ターン ──
  if (game.currentPlayerIndex !== 0 || p.isAllIn) {
    const wrap = document.createElement('div');
    wrap.className = 'mobile-action-wrap mob-simple-wrap';
    const cur = game.getCurrentPlayer();
    if (cur && cur.id !== 0) {
      const msg = document.createElement('span');
      msg.className = 'waiting-msg';
      msg.textContent = `${cur.name}'s turn...`;
      wrap.appendChild(msg);
    }
    el.appendChild(wrap); return;
  }

  // ── 人間のターン: モバイル専用UI ──
  const valid   = game.getValidActions(p);
  const toCall  = game.currentBet - p.currentBet;
  const hasRaise = valid.includes(Action.RAISE) || valid.includes(Action.BET);
  const raiseAct = toCall > 0 ? Action.RAISE : Action.BET;
  // NLH ミニマムレイズ: currentBet + lastRaiseIncrement
  const minTotal = toCall > 0 ? game.currentBet + game.lastRaiseIncrement : game.bigBlind;
  const maxTotal = toCall > 0 ? p.chips + p.currentBet : p.chips;

  // mobileRaiseAmountを有効範囲にクランプ
  if (!mobileRaiseAmount || mobileRaiseAmount < minTotal || mobileRaiseAmount > maxTotal) {
    mobileRaiseAmount = minTotal;
  }

  const wrap = document.createElement('div');
  wrap.className = 'mobile-action-wrap';

  // ── ポットサイズプリセット (プリフロップ初回: 2BB系 / その他: 33%-100%) + カスタム ──
  if (hasRaise) {
    const pot  = game.pot;
    const bet  = game.currentBet;
    const isPreflopFirst = game.state === GameState.PREFLOP && game.currentBet <= game.bigBlind;
    const rawDefs = isPreflopFirst
      ? [
          { label:'2BB',   total: 2   * game.bigBlind },
          { label:'2.3BB', total: 23 },
          { label:'2.5BB', total: 25 },
          { label:'3BB',   total: 3   * game.bigBlind },
        ]
      : [
          { label:'33%',  total: potSizeTotal(0.33, bet, pot) },
          { label:'50%',  total: potSizeTotal(0.5,  bet, pot) },
          { label:'100%', total: potSizeTotal(1.0,  bet, pot) },
        ];
    const presetDefs = rawDefs
      .map(pd => ({ ...pd, total: Math.max(minTotal, Math.min(maxTotal, pd.total)) }))
      .filter(pd => pd.total >= minTotal && pd.total <= maxTotal);

    const presetsRow = document.createElement('div');
    presetsRow.className = 'mob-preset-row';

    for (const pd of presetDefs) {
      const btn = document.createElement('button');
      const isSel = !mobileCustomMode && mobileRaiseAmount === pd.total;
      btn.className = 'mob-preset-btn' + (isSel ? ' selected' : '');
      btn.innerHTML = `<span class="mpb-label">${pd.label}</span><span class="mpb-sub">${bb(pd.total)} BB</span>`;
      btn.onclick = () => { mobileRaiseAmount = pd.total; mobileCustomMode = false; renderMobileActions(); };
      presetsRow.appendChild(btn);
    }

    // カスタムボタン
    const custBtn = document.createElement('button');
    custBtn.className = 'mob-preset-btn mob-preset-custom' + (mobileCustomMode ? ' selected' : '');
    custBtn.innerHTML = `<span class="mpb-label">✎</span><span class="mpb-sub">Custom</span>`;
    custBtn.onclick = () => { mobileCustomMode = true; renderMobileActions(); };
    presetsRow.appendChild(custBtn);

    wrap.appendChild(presetsRow);

    // カスタム入力行（カスタムモード時のみ表示）
    if (mobileCustomMode) {
      const customRow = document.createElement('div');
      customRow.className = 'mob-custom-row';

      const minusBtn = document.createElement('button');
      minusBtn.className   = 'mob-step-btn';
      minusBtn.textContent = '−';
      // ±ボタンは0.5BB(=5chip)ステップ
      const STEP = Math.max(1, Math.round(BB / 2)); // 5chips = 0.5BB
      minusBtn.onclick = () => {
        mobileRaiseAmount = Math.max(minTotal, mobileRaiseAmount - STEP);
        renderMobileActions();
      };

      const inp = document.createElement('input');
      inp.type      = 'number';
      inp.className = 'mob-custom-input';
      inp.value     = bb(mobileRaiseAmount);
      inp.min       = bb(minTotal);
      inp.max       = bb(maxTotal);
      inp.step      = '0.1';
      inp.oninput = () => {
        const v = Math.round(parseFloat(inp.value) * BB); // 0.1BB = 1chip精度
        if (Number.isFinite(v) && v >= minTotal && v <= maxTotal) mobileRaiseAmount = v;
      };

      const unit = document.createElement('span');
      unit.className   = 'mob-custom-unit';
      unit.textContent = 'BB';

      const plusBtn = document.createElement('button');
      plusBtn.className   = 'mob-step-btn';
      plusBtn.textContent = '+';
      plusBtn.onclick = () => {
        mobileRaiseAmount = Math.min(maxTotal, mobileRaiseAmount + STEP);
        renderMobileActions();
      };

      customRow.appendChild(minusBtn);
      customRow.appendChild(inp);
      customRow.appendChild(unit);
      customRow.appendChild(plusBtn);
      wrap.appendChild(customRow);
    }
  }

  // ── アクションボタン（縦積み） ──
  const btns = document.createElement('div');
  btns.className = 'mobile-btns';

  if (hasRaise) {
    const raiseBtn = document.createElement('button');
    const isAllIn  = mobileRaiseAmount >= maxTotal;
    if (isAllIn) {
      raiseBtn.className   = 'mob-btn mob-allin';
      raiseBtn.textContent = `ALL IN  ${bb(p.chips)} BB`;
      raiseBtn.onclick     = () => humanAction(Action.ALL_IN);
    } else {
      raiseBtn.className   = 'mob-btn mob-raise';
      raiseBtn.textContent = `${toCall > 0 ? 'RAISE TO' : 'BET'}  ${bb(mobileRaiseAmount)} BB`;
      const amount = toCall > 0 ? mobileRaiseAmount - game.currentBet : mobileRaiseAmount;
      raiseBtn.onclick = () => humanAction(raiseAct, amount);
    }
    btns.appendChild(raiseBtn);
  }

  if (valid.includes(Action.CALL)) {
    const callBtn = document.createElement('button');
    callBtn.className   = 'mob-btn mob-call';
    callBtn.textContent = `CALL  ${bb(game.currentBet)} BB`;
    callBtn.onclick     = () => humanAction(Action.CALL);
    btns.appendChild(callBtn);
  } else if (valid.includes(Action.CHECK)) {
    const checkBtn = document.createElement('button');
    checkBtn.className   = 'mob-btn mob-check';
    checkBtn.textContent = 'CHECK';
    checkBtn.onclick     = () => humanAction(Action.CHECK);
    btns.appendChild(checkBtn);
  }

  if (valid.includes(Action.FOLD)) {
    const foldBtn = document.createElement('button');
    foldBtn.className   = 'mob-btn mob-fold';
    foldBtn.textContent = 'FOLD';
    foldBtn.onclick     = () => humanAction(Action.FOLD);
    btns.appendChild(foldBtn);
  }

  wrap.appendChild(btns);
  el.appendChild(wrap);
}

// ------- アクションレンダリング -------
function renderActions() {
  if (window.innerWidth <= 500) { renderMobileActions(); return; }
  const el = document.getElementById('actions');
  el.innerHTML = '';

  // オールインランアウト中
  if (isRunout()) {
    const bar = mkActionBar();
    const msg = document.createElement('span');
    msg.className = 'waiting-msg';
    msg.textContent = 'ALL IN — RUNOUT';
    bar.appendChild(msg);
    el.appendChild(bar); return;
  }

  // SHOWDOWN / COMPLETE
  if (game.state === GameState.COMPLETE || game.state === GameState.SHOWDOWN) {
    const bar = mkActionBar();
    const b   = mkBtn('deal', 'NEXT HAND'); b.onclick = startNewHand;
    bar.appendChild(b); el.appendChild(bar); return;
  }

  const p = game.players[0];

  // フォールド済み → NEXT HAND + CPU続行
  if (p.folded && game.currentPlayerIndex !== 0) {
    const bar = mkActionBar();
    const b   = mkBtn('deal', 'NEXT HAND'); b.onclick = fastForwardHand;
    bar.appendChild(b); el.appendChild(bar);
    if (game.state !== GameState.COMPLETE && game.state !== GameState.SHOWDOWN)
      setTimeout(cpuTurn, 550);
    return;
  }

  // CPU ターン中
  if (game.currentPlayerIndex !== 0 || p.isAllIn) {
    const cur = game.getCurrentPlayer();
    const bar = mkActionBar();
    if (cur && cur.id !== 0) {
      const msg = document.createElement('span');
      msg.className = 'waiting-msg';
      msg.textContent = `${cur.name}'s turn...`;
      bar.appendChild(msg);
    }
    el.appendChild(bar); return;
  }

  // 人間のターン
  const valid  = game.getValidActions(p);
  const toCall = game.currentBet - p.currentBet;

  const bar = mkActionBar();

  // ── 左グループ: FOLD / CHECK / CALL ──
  const leftGrp = mkGroup();

  if (valid.includes(Action.FOLD)) {
    const b = mkBtn('fold', '<span class="btn-label">FOLD</span>');
    b.onclick = () => humanAction(Action.FOLD);
    leftGrp.appendChild(b);
  }
  if (valid.includes(Action.CHECK)) {
    const b = mkBtn('check', '<span class="btn-label">CHECK</span>');
    b.onclick = () => humanAction(Action.CHECK);
    leftGrp.appendChild(b);
  } else if (valid.includes(Action.CALL)) {
    // テーブル上の合計額を表示（差分ではなく）
    const b = mkBtn('call', `<span class="btn-label">CALL</span><span class="btn-sub">${bb(game.currentBet)} BB</span>`);
    b.onclick = () => humanAction(Action.CALL);
    leftGrp.appendChild(b);
  }
  bar.appendChild(leftGrp);

  // ── 中央グループ: レイズプリセット ──
  const hasRaise = valid.includes(Action.RAISE) || valid.includes(Action.BET);
  if (hasRaise) {
    bar.appendChild(mkDivider());
    const { presets, minTotal, maxTotal, raiseAct } = computeRaisePresets(p);
    const midGrp = mkGroup();

    for (const ps of presets) {
      const b = document.createElement('button');
      b.className = 'raise-preset-btn rp-raise';
      b.innerHTML = `<span class="rpb-label">${ps.label}</span><span class="rpb-sub">${bb(ps.total)} BB</span>`;
      const amount = ps.amount;
      b.onclick = () => humanAction(raiseAct, amount);
      midGrp.appendChild(b);
    }
    // カスタムボタン
    const cust = document.createElement('button');
    cust.className = 'raise-preset-btn rp-custom';
    cust.innerHTML = '<span class="rpb-label">▲</span><span class="rpb-sub">Custom</span>';
    cust.onclick = () => showSlider(raiseAct);
    midGrp.appendChild(cust);

    bar.appendChild(midGrp);
  }

  // ── 右グループ: ALL IN ──
  if (valid.includes(Action.ALL_IN)) {
    bar.appendChild(mkDivider());
    const rightGrp = mkGroup();
    const b = mkBtn('all_in', `<span class="btn-label">ALL IN</span><span class="btn-sub">${bb(p.chips)} BB</span>`);
    b.onclick = () => humanAction(Action.ALL_IN);
    rightGrp.appendChild(b);
    bar.appendChild(rightGrp);
  }

  el.appendChild(bar);
}

// ------- スライダーUI（カスタムレイズ） — slider値 = テーブル上合計 -------
function showSlider(act) {
  const p        = game.players[0];
  const isRaiseA = act === Action.RAISE;
  // minTotal / maxTotal: テーブル上に出す合計
  const minTotal = isRaiseA ? game.currentBet + game.lastRaiseIncrement : game.bigBlind;
  const maxTotal = isRaiseA ? p.chips + p.currentBet : p.chips;
  const pot = game.pot;

  const bet = game.currentBet;
  const presets = [
    { label:'Min',    total:minTotal },
    { label:'33%',    total:potSizeTotal(0.33, bet, pot) },
    { label:'50%',    total:potSizeTotal(0.5,  bet, pot) },
    { label:'100%',   total:potSizeTotal(1.0,  bet, pot) },
    { label:'All In', total:maxTotal },
  ].filter((ps,i,arr)=>{
    const t=Math.max(minTotal,Math.min(maxTotal,ps.total));
    if(t<minTotal||t>maxTotal) return false;
    return arr.findIndex(x=>Math.max(minTotal,Math.min(maxTotal,x.total))===t)===i;
  });

  const presetBtns = presets.map(ps=>{
    const t=Math.max(minTotal,Math.min(maxTotal,ps.total));
    return `<button class="preset-btn" onclick="setSlider(${t})">${ps.label}<span class="preset-sub">${bb(t)} BB</span></button>`;
  }).join('');

  document.getElementById('actions').innerHTML=`
    <div class="action-bar">
      <div class="raise-wrap">
        <div class="raise-presets">${presetBtns}</div>
        <div class="raise-input-row">
          <button class="action-btn cancel" onclick="renderActions()">←</button>
          <input type="range" id="rslider" min="${minTotal}" max="${maxTotal}" value="${minTotal}" step="1" oninput="syncFromSlider(this.value)">
          <div class="raise-input-group">
            <input type="number" id="rbb" min="${bb(minTotal)}" max="${bb(maxTotal)}" step="0.5" value="${bb(minTotal)}" oninput="syncFromInput(this.value)">
            <span class="raise-input-unit">BB</span>
          </div>
          <button class="action-btn confirm" onclick="confirmRaise('${act}')">OK</button>
        </div>
      </div>
    </div>`;
}

function syncFromSlider(v) {
  document.getElementById('rbb').value=bb(parseInt(v));
}
function syncFromInput(bbVal) {
  const chips=Math.round(parseFloat(bbVal)*BB);
  const s=document.getElementById('rslider');
  s.value=Math.max(+s.min,Math.min(+s.max,chips));
}
function setSlider(total) {
  const s=document.getElementById('rslider');
  const t=Math.max(+s.min,Math.min(+s.max,total));
  s.value=t; document.getElementById('rbb').value=bb(t);
}
function confirmRaise(act) {
  const total=parseInt(document.getElementById('rslider').value);
  const amount = act === Action.RAISE ? total - game.currentBet : total;
  humanAction(act, amount);
}

// ------- 人間アクション -------
function humanAction(act, amount=0) {
  const callTotal=game.currentBet; // CALLは合計表示用に事前キャプチャ
  try { game.performAction(0,act,amount); } catch(e) { console.error(e); return; }

  const info=ACTION_LABELS[act];
  if(info){
    let label=info.label;
    if(act===Action.CALL) label+=`  ${bb(callTotal)} BB`;
    if((act===Action.BET||act===Action.RAISE)&&amount>0) label+=`  ${bb(game.currentBet)} BB`;
    if(act===Action.ALL_IN) label+=`  ${bb(game.players[0].totalBet)} BB`;
    lastActions[0]={...info,label};
    lastActorId=0;
  }
  renderAll();
  if (isRunout()) { scheduleRunout(); return; }
  if(game.state!==GameState.COMPLETE&&game.state!==GameState.SHOWDOWN)
    if(game.currentPlayerIndex!==0) setTimeout(cpuTurn,800);
}

function fastForwardHand() {
  if(game.state===GameState.COMPLETE||game.state===GameState.SHOWDOWN){ startNewHand(); return; }
  cpuTurn();
}

// ------- CPU -------
function cpuTurn() {
  if(game.state===GameState.COMPLETE||game.state===GameState.SHOWDOWN){ renderAll(); return; }
  const p=game.getCurrentPlayer();
  if(!p||p.id===0){ renderAll(); return; }

  renderActions();

  const valid=game.getValidActions(p);
  const toCall=game.currentBet-p.currentBet;
  const callTotal=game.currentBet; // CALLは合計表示用に事前キャプチャ
  const potOdds=toCall>0?toCall/(game.pot+toCall):0;
  const rng=new Uint32Array(1); crypto.getRandomValues(rng);
  const rand=rng[0]/0xFFFFFFFF;

  let act=Action.FOLD,amount=0;
  if(toCall===0){
    act=rand<0.65?Action.CHECK
       :rand<0.88&&valid.includes(Action.BET)?(amount=game.bigBlind*(2+Math.floor(rand*3)),Action.BET)
       :Action.CHECK;
  } else {
    act=potOdds>0.4?(rand<0.55?Action.FOLD:Action.CALL)
       :rand<0.15&&valid.includes(Action.RAISE)?(amount=toCall+game.bigBlind*2,Action.RAISE)
       :rand<0.78&&valid.includes(Action.CALL)?Action.CALL
       :Action.FOLD;
  }
  if(!valid.includes(act)) act=valid.includes(Action.CHECK)?Action.CHECK:Action.FOLD;

  try { game.performAction(p.id,act,amount); }
  catch(e){ game.performAction(p.id,valid.includes(Action.CHECK)?Action.CHECK:Action.FOLD); }

  const info=ACTION_LABELS[act];
  if(info){
    let label=info.label;
    if(act===Action.CALL) label+=`  ${bb(callTotal)} BB`;
    if((act===Action.BET||act===Action.RAISE)&&amount>0) label+=`  ${bb(game.currentBet)} BB`;
    lastActions[p.id]={...info,label};
    lastActorId=p.id;
  }
  renderAll();
  if (isRunout()) { scheduleRunout(); return; }
  if(game.state!==GameState.COMPLETE&&game.state!==GameState.SHOWDOWN)
    if(game.currentPlayerIndex!==0) setTimeout(cpuTurn,950);
}

// ------- オールインランアウト -------
function isRunout() {
  if (!game) return false;
  if (game.state === GameState.SHOWDOWN || game.state === GameState.COMPLETE || game.state === GameState.WAITING) return false;
  // currentPlayerIndex が -1 = 誰もアクション不要（全員オールイン or フォールド済み）かつ複数が手札を持つ
  return game.currentPlayerIndex === -1 && game.activeInHandPlayers.length > 1;
}

function scheduleRunout() {
  if (!isRunout()) return;
  // フロップは3枚stagger(0+0.3+0.6s)完了まで待つため長め、ターン/リバーは短め
  const delay = game.state === GameState.FLOP ? 1400 : 950;
  setTimeout(() => {
    if (!game || game.state === GameState.SHOWDOWN || game.state === GameState.COMPLETE) return;
    game.advanceStreet();
    renderAll();
    scheduleRunout(); // 次のストリートが残っていれば再スケジュール
  }, delay);
}

// ------- ログ -------
function renderLog() {
  const el=document.getElementById('action-log');
  el.innerHTML=game.actionLog.slice(-5).map(m=>`<div class="log-entry">${esc(m)}</div>`).join('');
  el.scrollTop=el.scrollHeight;
}

function backToSetup() {
  document.getElementById('game-screen').classList.add('hidden');
  document.getElementById('setup-screen').classList.remove('hidden');
  game=null; lastActions={}; lastActorId=-1; prevStreet=null;
}
