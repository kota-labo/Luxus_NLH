// UIコントローラー v12 — Luxu's Poker

let game = null;
const BB = 10;

const SEATS = {
  2: [[50,74],[50,26]],
  3: [[50,74],[18,32],[82,32]],
  4: [[50,74],[14,50],[50,26],[86,50]],
  5: [[50,74],[13,58],[24,23],[76,23],[87,58]],
  6: [[50,74],[12,58],[21,23],[50,25],[79,23],[88,58]],
};
const COLORS = ['#1e88e5','#8e24aa','#00897b','#e53935','#fb8c00','#43a047'];

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
  const n = parseInt(document.querySelector('.player-num.selected').dataset.val);
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
  const t = document.documentElement.getAttribute('data-theme') || 'classic';
  const c = document.documentElement.getAttribute('data-card')  || 'blue';
  document.querySelectorAll('.theme-opt').forEach(b => b.classList.toggle('active', b.dataset.theme === t));
  document.querySelectorAll('.card-theme-btn').forEach(b => b.classList.toggle('active', b.dataset.card === c));
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
function computeRaisePresets(player) {
  const toCall = game.currentBet - player.currentBet;
  const isRaise = toCall > 0;
  const raiseAct = isRaise ? Action.RAISE : Action.BET;
  // minTotal / maxTotal はテーブル上に出す合計
  const minTotal = isRaise ? game.currentBet + game.bigBlind : game.bigBlind;
  const maxTotal = isRaise ? player.chips + player.currentBet : player.chips;
  const pot = game.pot;

  const candidates = [
    { label:'½P', total: Math.round(pot * 0.5 / BB) * BB },
    { label:'Pot', total: Math.round(pot / BB) * BB },
    { label:'2P',  total: Math.round(pot * 2 / BB) * BB },
  ];

  const seen = new Set();
  const presets = [];
  for (const r of candidates) {
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
  const pos = SEATS[game.players.length] || SEATS[6];

  game.players.forEach((p, i) => {
    const isDlr    = i === game.dealerIndex;
    const isSB     = i === game.getSBIndex();
    const isBB     = i === game.getBBIndex();
    const isActive = i === game.currentPlayerIndex && game.state !== GameState.COMPLETE;
    const isHuman  = i === 0;
    const isSD     = game.state === GameState.SHOWDOWN || game.state === GameState.COMPLETE;

    const seat = document.createElement('div');
    // オールイン中はバスト扱いにしない（チップ0でもアクティブ表示）
    seat.className = `seat${isActive?' seat-active':''}${p.folded?' seat-folded':''}${p.chips<=0&&!p.isAllIn?' seat-bust':''}`;
    seat.style.left = pos[i][0] + '%';
    seat.style.top  = pos[i][1] + '%';

    // ポジションチップ（SB/BBのみ座席に表示。Dはテーブル上に別途描画）
    const posChip = isSB ? '<div class="pos-chip bsb">SB</div>'
                  : isBB ? '<div class="pos-chip bbb">BB</div>'
                  : '';

    // ホールカード（オールインランアウト中も全員のハンドを公開）
    const showFaceUp = isHuman || isSD || isRunout();
    let cards = '';
    if (p.hand.length && !p.folded) {
      if (showFaceUp) {
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

    seat.innerHTML = `
      ${arrow}
      <div class="cards-row">${cards}</div>
      ${bubble}
      ${posChip}
      <div class="seat-pill">
        <div class="av" style="background:${COLORS[i]}">${p.name[0]}</div>
        <div class="pinfo">
          <span class="pname">${p.name}</span>
          <span class="pstack">${bb(p.chips)} BB</span>
        </div>
      </div>
      ${hname}${stt}
    `;
    el.appendChild(seat);

    // ベットチップをテーブル上（座席とポットの中間）に配置
    if (p.currentBet > 0) {
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
  dbtn.style.left = (dPos[0] * 0.70 + 50 * 0.30) + '%';
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

// ------- アクションレンダリング -------
function renderActions() {
  const el = document.getElementById('actions');
  el.innerHTML = '';

  // オールインランアウト中
  if (isRunout()) {
    const bar = mkBar();
    bar.innerHTML = '<span class="waiting-msg">ALL IN — RUNOUT</span>';
    el.appendChild(bar); return;
  }

  // SHOWDOWN / COMPLETE
  if (game.state === GameState.COMPLETE || game.state === GameState.SHOWDOWN) {
    const bar = mkBar();
    const b   = mkBtn('deal', 'NEXT HAND'); b.onclick = startNewHand;
    bar.appendChild(b); el.appendChild(bar); return;
  }

  const p = game.players[0];

  // フォールド済み → NEXT HAND + CPU続行
  if (p.folded && game.currentPlayerIndex !== 0) {
    const bar = mkBar();
    const b   = mkBtn('deal', 'NEXT HAND'); b.onclick = fastForwardHand;
    bar.appendChild(b); el.appendChild(bar);
    if (game.state !== GameState.COMPLETE && game.state !== GameState.SHOWDOWN)
      setTimeout(cpuTurn, 550);
    return;
  }

  // CPU ターン中
  if (game.currentPlayerIndex !== 0 || p.isAllIn) {
    const cur = game.getCurrentPlayer();
    const bar = mkBar();
    if (cur && cur.id !== 0)
      bar.innerHTML = `<span class="waiting-msg">${cur.name}'s turn...</span>`;
    el.appendChild(bar); return;
  }

  // 人間のターン
  const valid  = game.getValidActions(p);
  const toCall = game.currentBet - p.currentBet;

  const bar = mkBar();

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
  const p      = game.players[0];
  const isRaise = act === Action.RAISE;
  // minTotal / maxTotal: テーブル上に出す合計
  const minTotal = isRaise ? game.currentBet + game.bigBlind : game.bigBlind;
  const maxTotal = isRaise ? p.chips + p.currentBet : p.chips;
  const pot = game.pot;

  const presets = [
    { label:'Min',    total:minTotal },
    { label:'⅓ Pot',  total:Math.round(pot*0.33/BB)*BB },
    { label:'½ Pot',  total:Math.round(pot*0.5/BB)*BB },
    { label:'⅔ Pot',  total:Math.round(pot*0.67/BB)*BB },
    { label:'Pot',    total:pot },
    { label:'2× Pot', total:pot*2 },
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
          <input type="range" id="rslider" min="${minTotal}" max="${maxTotal}" value="${minTotal}" step="${BB}" oninput="syncFromSlider(this.value)">
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
  el.innerHTML=game.actionLog.slice(-5).map(m=>`<div class="log-entry">${m}</div>`).join('');
  el.scrollTop=el.scrollHeight;
}

function backToSetup() {
  document.getElementById('game-screen').classList.add('hidden');
  document.getElementById('setup-screen').classList.remove('hidden');
  game=null; lastActions={}; lastActorId=-1; prevStreet=null;
}
