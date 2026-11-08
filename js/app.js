// Main UI: hash routing over five tabs, Bible reader, quiet-time timer, stamp animation, profile sheet.
(function () {
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const STAMP_CHAR = { o: '讀', m: '補', l: '完' };
  const STATUS_TEXT = {
    ontime: '準時完成', makeup: '補讀完成', late: '逾期補完', today: '今天還沒讀', pending: '待補讀', missed: '已錯過', future: '還沒到',
    before: '加入前',
  };
  const READ = ['ontime', 'makeup', 'late'];
  const BADGE_ICON = {
    'total-1': '🌱', 'total-7': '📖', 'total-21': '🔁', 'total-50': '⭐', 'total-100': '💯', 'total-200': '⛰️', 'total-all': '🏆',
    'streak-7': '🔥', 'streak-30': '🔥', 'streak-100': '🔥',
  };

  let params = new URLSearchParams(location.search);
  const isMock = !CONFIG.LIFF_ID || params.get('mock') === '1';
  let api = null;
  let liffCtx = null;
  const S = {}; // app state

  // ---------- helpers ----------
  const md = date => { const p = date.split('-').map(Number); return p[1] + '/' + p[2]; };
  const wd = date => WEEKDAYS[Core.weekday(date)];
  const pct = x => Math.round(x * 100) + '%';
  const clampDay = d => Math.min(Math.max(d, 1), S.total);
  const curDay = () => clampDay(S.todayDay);
  const isReadDay = d => Core.isRead(Core.stampAt(S.me.record, d));
  const F = () => S.me.fromDay || 1; // plan day the member joined

  function toast(msg, ms) {
    $$('.toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms || 2600);
  }

  function pill(status) {
    const cls = READ.includes(status) ? status : 'todo';
    return `<span class="status-pill ${cls}">${READ.includes(status) ? '✓ ' : ''}${STATUS_TEXT[status]}</span>`;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('無法載入 ' + src));
      document.head.appendChild(s);
    });
  }

  function applyBoot(b) {
    S.today = b.today;
    S.plan = b.plan;
    S.days = b.plan.days;
    S.total = S.days.length;
    S.start = b.plan.start;
    S.todayDay = Core.dayNumber(S.start, S.today);
    S.groups = b.groups || [];
    S.me = b.me;
    S.me.record = Core.normalizeRecord(S.me.record, S.total);
    S.questions = b.questions || [];
    S.refs = S.days.map(d => Core.parseRefs(d.refs));
    S.dayGroups = S.refs.map(r => Core.groupsOf(r, Books));
    S.totalChapters = S.days.reduce((s, d) => s + d.chapters, 0);
  }

  // ---------- routing ----------
  function render() {
    const parts = (location.hash.slice(1) || 'today').split('/');
    const tab = parts[0];
    const arg = parts[1] ? +parts[1] : null;
    $$('.tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
    const views = { today: renderToday, card: renderCard, progress: renderProgress, rank: renderRank, notes: renderNotes };
    stopTimer();
    (views[tab] || renderToday)($('#view'), arg);
    window.scrollTo(0, 0);
  }
  function go(hash) {
    if (location.hash === hash) render(); else location.hash = hash;
  }

  // ---------- today / reader ----------
  function renderToday(view, dayArg) {
    const td = S.todayDay;
    const day = dayArg ? clampDay(dayArg) : curDay();
    const d = S.days[day - 1];
    const status = Core.dayStatus(S.me.record, day, td, F());
    const st = Core.streak(S.me.record, td, F());
    const isToday = day === td;
    let h = '';

    h += `<div class="hero"><div><div class="date">${md(d.date)}</div>
      <div class="meta">${wd(d.date)}・第 ${d.week} 週第 ${d.dow} 天 · Day ${day}/${S.total}</div></div>
      <div class="streak"><div class="n">${st.current}</div><div class="l">🔥 連勝天數</div></div></div>`;

    if (td < 1) {
      h += `<div class="card notice"><b>距離 ${md(S.start)} 開跑還有 ${1 - td} 天</b>
        <div class="small muted">先看看第一天要讀什麼，開跑當天就可以蓋章了。</div></div>`;
    } else if (td > S.total) {
      const comp = Core.completion(S.me.record, S.total, F());
      h += `<div class="card notice"><b>52 週讀經結束了！</b>
        <div class="small muted">你一共讀完 ${comp.done} 天（${pct(comp.rate)}）。還沒讀的部分，現在補還是會算進全本進度。</div></div>`;
    } else if (!isToday && day < td) {
      h += `<div class="card notice"><b>正在補讀第 ${day} 天（${md(d.date)}）</b>
        <div class="small muted">${status === 'before' ? '這是你加入前的進度，不讀也不影響連勝；讀了會計入全本進度。'
          : status === 'missed' ? '已經超過 7 天，補完會計入全本進度，但不會救回連勝。' : '7 天內補完，連勝不會斷。'}</div>
        <div class="chips"><button class="chip" data-go="#today">回到今天</button></div></div>`;
    }
    if (isToday && st.pending.length) {
      h += `<div class="card notice"><b>有 ${st.pending.length} 天待補讀</b>
        <div class="small muted">7 天內補完，連勝不會斷。</div>
        <div class="chips">${st.pending.map(p => `<button class="chip warn" data-go="#today/${p}">${md(S.days[p - 1].date)}・第 ${p} 天</button>`).join('')}</div></div>`;
    }

    h += `<div class="card"><h2>${isToday ? '今日進度' : '第 ' + day + ' 天進度'}</h2>
      <div class="passage-title"><span class="mark">${esc(d.label)}</span></div>
      <div class="passage-meta"><span>約 ${d.minutes} 分鐘 · ${d.chapters} 章</span>${pill(status)}</div>
      ${d.note ? `<div class="small muted" style="margin-top:8px">${esc(d.note)}</div>` : ''}
      ${d.link ? `<a class="course-link" href="${esc(d.link)}" target="_blank" rel="noopener">打開今天的課程 →</a>` : ''}
      <div class="actions"><button class="btn block ghost" id="startBtn">${READ.includes(status) ? '再讀一次' : '開始讀經'}</button></div></div>`;
    h += `<div class="card reader hidden" id="reader"></div>`;
    h += `<div class="timer hidden" id="timer"></div>`;
    h += `<div id="checkinArea">${checkinHtml(day, status)}</div>`;
    h += `<p class="small muted" style="text-align:center;margin-top:18px">讀到不懂的地方？<a href="#notes/${day}">記在疑問本</a></p>`;
    view.innerHTML = `<div class="view">${h}</div>`;

    $$('[data-go]', view).forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
    $('#startBtn').addEventListener('click', () => openReader(day));
    bindCheckin(day);
    if (params.get('read') === '1') { params.delete('read'); openReader(day); }
  }

  function checkinHtml(day, status) {
    if (READ.includes(status)) {
      return `<button class="btn block done" disabled>✓ ${STATUS_TEXT[status]}</button>
        ${canShare() ? '<button class="btn block ghost" id="shareBtn" style="margin-top:10px">分享到群組</button>' : ''}`;
    }
    if (S.todayDay < 1) return `<button class="btn block" disabled>開跑後就能蓋章</button>`;
    if (status === 'future') return `<button class="btn block" disabled>還沒到第 ${day} 天</button>`;
    const label = status === 'today' ? '我讀完了，蓋章！' : status === 'pending' ? '補讀完成，蓋章！'
      : status === 'before' ? '讀完了（加入前的進度）' : '讀完了（逾期補讀）';
    return `<button class="btn block" id="checkinBtn">${label}</button>`;
  }

  function bindCheckin(day) {
    const btn = $('#checkinBtn');
    if (btn) btn.addEventListener('click', () => doCheckin(day, btn));
    const share = $('#shareBtn');
    if (share) share.addEventListener('click', () => shareDay(day));
  }

  const chapterCache = new Map();
  function loadChapter(book, c) {
    const k = book + '.' + c;
    if (!chapterCache.has(k)) {
      chapterCache.set(k, fetch(`bible/${book}/${c}.json`).then(r => {
        if (!r.ok) throw new Error('missing ' + k);
        return r.json();
      }).catch(e => { chapterCache.delete(k); throw e; }));
    }
    return chapterCache.get(k);
  }

  async function openReader(day) {
    const box = $('#reader');
    if (!box) return;
    box.classList.remove('hidden');
    $('#startBtn').classList.add('hidden');
    box.innerHTML = `<div class="reader-tools"><span class="small muted">和合本</span>
      <div class="size-btns"><button data-size="-1" aria-label="字變小">A−</button><button data-size="1" aria-label="字變大">A＋</button></div></div>
      <div id="chapters"><div class="loading">經文載入中…</div></div>`;
    $$('[data-size]', box).forEach(b => b.addEventListener('click', () => setReaderSize(+b.dataset.size)));
    showTimer();
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const jobs = [];
    S.refs[day - 1].forEach(r => { for (let c = r.from; c <= r.to; c++) jobs.push(loadChapter(r.book, c)); });
    try {
      const chapters = await Promise.all(jobs);
      $('#chapters').innerHTML = chapters.map(ch => {
        const b = Books.get(ch.b);
        const unit = ch.b === 'PSA' ? '篇' : '章';
        return `<section class="chapter"><h3>${b.name} 第 ${ch.c} ${unit}</h3>
          ${ch.v.map(v => `<p><sup>${v[0]}</sup>${esc(v[1])}</p>`).join('')}</section>`;
      }).join('') + `<p class="source">經文：和合本（數位文本來源：信望愛站 FHL）</p>`;
    } catch (e) {
      $('#chapters').innerHTML = `<p class="muted">經文載入失敗，請先用自己的聖經讀，讀完一樣可以蓋章。</p>`;
    }
  }

  function setReaderSize(delta) {
    const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--reader-size'), 10) || 19;
    const next = Math.min(28, Math.max(15, cur + delta * 2));
    document.documentElement.style.setProperty('--reader-size', next + 'px');
    try { localStorage.setItem('brq-reader-size', next); } catch (e) { /* ignore */ }
  }
  function restoreReaderSize() {
    try {
      const v = +localStorage.getItem('brq-reader-size');
      if (v) document.documentElement.style.setProperty('--reader-size', v + 'px');
    } catch (e) { /* ignore */ }
  }

  // ---------- quiet-time timer ----------
  const T = { minutes: 10, left: 600, running: false, id: null };
  let audio = null;

  function showTimer() {
    const el = $('#timer');
    if (!el) return;
    T.minutes = S.me.quietMinutes || 10;
    T.left = T.minutes * 60;
    el.classList.remove('hidden');
    el.innerHTML = `<button class="play" id="playBtn" aria-label="開始計時"></button>
      <div class="time" id="timeTxt"></div><div class="ring"><i id="ringBar"></i></div>
      <div class="presets">${[5, 10, 30].map(m => `<button data-min="${m}">${m} 分</button>`).join('')}</div>`;
    $('#playBtn').addEventListener('click', () => (T.running ? pauseTimer() : startTimer()));
    $$('[data-min]', el).forEach(b => b.addEventListener('click', () => {
      pauseTimer(); T.minutes = +b.dataset.min; T.left = T.minutes * 60; drawTimer();
    }));
    drawTimer();
  }
  function drawTimer() {
    if (!$('#timeTxt')) return;
    const m = Math.floor(T.left / 60);
    const s = T.left % 60;
    $('#timeTxt').textContent = m + ':' + (s < 10 ? '0' : '') + s;
    $('#ringBar').style.width = (100 - T.left / (T.minutes * 60) * 100) + '%';
    $('#playBtn').innerHTML = T.running
      ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    $$('[data-min]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.min === T.minutes ? 'true' : 'false'));
  }
  function startTimer() {
    if (T.left <= 0) T.left = T.minutes * 60;
    unlockAudio();
    T.running = true;
    T.id = setInterval(() => {
      T.left--;
      if (T.left <= 0) { T.left = 0; pauseTimer(); chime(); toast('安靜時間到了，讀完記得蓋章 🙏', 4000); }
      drawTimer();
    }, 1000);
    drawTimer();
  }
  function pauseTimer() {
    T.running = false;
    clearInterval(T.id);
    drawTimer();
  }
  function stopTimer() {
    T.running = false;
    clearInterval(T.id);
  }
  function unlockAudio() {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
    } catch (e) { audio = null; }
  }
  function chime() {
    if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
    if (!audio) return;
    const now = audio.currentTime;
    [[784, 0], [1175, 0.18]].forEach(([f, t]) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + t);
      g.gain.exponentialRampToValueAtTime(0.3, now + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t + 1.6);
      o.connect(g).connect(audio.destination);
      o.start(now + t); o.stop(now + t + 1.7);
    });
  }

  // ---------- check-in & stamp ----------
  async function doCheckin(day, btn) {
    btn.disabled = true;
    btn.textContent = '蓋章中…';
    const beforeBadges = Core.badges(S.me.record, S.todayDay, S.dayGroups, Books, F());
    const beforeFull = Core.cards(S.me.record, S.todayDay, F()).filter(c => c.full).length;
    let r;
    try {
      r = await api.checkin(day);
    } catch (e) {
      handleError(e);
      btn.disabled = false;
      btn.textContent = '再按一次';
      return;
    }
    if (!r.ok) {
      toast(r.error === 'already' ? '這天已經蓋過章了' : r.error === 'future' ? '還沒到這一天喔' : '沒有蓋成功，請再試一次');
      if (r.record) S.me.record = Core.normalizeRecord(r.record, S.total);
      render();
      return;
    }
    S.me.record = Core.normalizeRecord(r.record, S.total);
    S.board = null;
    const st = Core.streak(S.me.record, S.todayDay, F());
    const defs = Core.badgeDefs(S.dayGroups, Books);
    const gained = Core.badges(S.me.record, S.todayDay, S.dayGroups, Books, F())
      .filter(id => !beforeBadges.includes(id))
      .map(id => defs.find(b => b.id === id).name);
    const afterFull = Core.cards(S.me.record, S.todayDay, F()).filter(c => c.full).length;
    render();
    showStamp(r.stamp, st.current, gained, afterFull > beforeFull);
  }

  function showStamp(stamp, streak, gained, cardFilled) {
    const cls = stamp === 'm' ? 'makeup' : stamp === 'l' ? 'late' : '';
    const msg = stamp === 'o' ? `連勝 ${streak} 天！` : stamp === 'm' ? `補讀成功，連勝 ${streak} 天` : '完成！已計入全本進度';
    const extra = [];
    if (cardFilled) extra.push('集滿一張集點卡了！');
    if (gained.length) extra.push('獲得徽章：' + gained.join('、'));
    const el = document.createElement('div');
    el.className = 'stamp-overlay';
    el.innerHTML = `<div class="stamp-box"><div class="big-seal ${cls}">${STAMP_CHAR[stamp]}</div>
      <div class="msg">${msg}</div>${extra.length ? `<div class="msg2">${esc(extra.join('　'))}</div>` : ''}</div>`;
    document.body.appendChild(el);
    if (navigator.vibrate) navigator.vibrate(40);
    const close = () => el.remove();
    el.addEventListener('click', close);
    setTimeout(close, extra.length ? 3600 : 2400);
  }

  function canShare() {
    if (isMock) return true;
    return !!(liffCtx && ['utou', 'room', 'group'].includes(liffCtx.type));
  }
  async function shareDay(day) {
    const st = Core.streak(S.me.record, S.todayDay, F());
    const text = `✅ ${S.me.name} 讀完了第 ${day} 天：${S.days[day - 1].label}\n🔥 連勝 ${st.current} 天`;
    if (isMock) { toast('示範模式：正式版會由你本人把這段話送到群組。\n' + text, 4000); return; }
    try {
      await liff.sendMessages([{ type: 'text', text: text }]);
      toast('已分享到群組');
    } catch (e) {
      toast('這裡不能分享，請從群組裡的早安圖打開再試');
    }
  }

  // ---------- stamp card ----------
  function renderCard(view, idxArg) {
    const cards = Core.cards(S.me.record, S.todayDay, F());
    const curIdx = Math.floor((curDay() - 1) / Core.CARD_SIZE) + 1;
    const idx = idxArg ? Math.min(Math.max(idxArg, 1), cards.length) : curIdx;
    const c = cards[idx - 1];
    const filled = c.slots.filter(s => READ.includes(s.status)).length;
    const fullCount = cards.filter(x => x.full).length;
    const slotInner = s => {
      const ch = Core.stampAt(S.me.record, s.day);
      if (READ.includes(s.status)) return STAMP_CHAR[ch];
      if (s.status === 'today') return '今';
      if (s.status === 'pending') return '待補';
      return s.day;
    };

    let h = `<div class="card"><div class="card-head"><div>
        <div class="title">第 ${idx} 張集點卡</div>
        <div class="small muted">${md(S.days[c.from - 1].date)} – ${md(S.days[c.to - 1].date)}　已集 <b class="num">${filled}</b> / ${c.slots.length}</div></div>
      <div class="card-nav"><button data-go="#card/${idx - 1}" ${idx <= 1 ? 'disabled' : ''} aria-label="上一張">‹</button>
        <button data-go="#card/${idx + 1}" ${idx >= cards.length ? 'disabled' : ''} aria-label="下一張">›</button></div></div>
      <div class="slots">${c.slots.map(s => `<button class="slot ${s.status}" data-day="${s.day}" aria-label="第 ${s.day} 天 ${STATUS_TEXT[s.status]}">
        ${slotInner(s)}<small>${md(S.days[s.day - 1].date)}</small></button>`).join('')}</div>
      <div class="legend"><span><i style="background:var(--seal)"></i>準時</span><span><i style="background:var(--makeup)"></i>7 天內補讀</span>
        <span><i style="background:var(--late)"></i>逾期補完</span><span><i style="border:2px dashed var(--pending)"></i>待補讀</span></div></div>`;
    h += `<p class="small muted" style="margin:4px 4px 0">21 天養成一個習慣，集滿一張就換下一張。目前已集滿 <b>${fullCount}</b> 張。
      <a href="#" id="rulesLink">怎麼玩？</a></p>`;

    const earned = Core.badges(S.me.record, S.todayDay, S.dayGroups, Books, F());
    const defs = Core.badgeDefs(S.dayGroups, Books);
    h += `<div class="section-title">我的徽章（${earned.length} / ${defs.length}）</div><div class="badges">${defs.map(b => {
      const got = earned.includes(b.id);
      return `<div class="badge ${got ? '' : 'locked'}" title="${esc(b.desc)}"><div class="medal">${BADGE_ICON[b.id] || '📜'}</div>
        <div class="name">${esc(b.name)}</div><div class="small muted" style="font-size:11px">${got ? '已獲得' : esc(b.desc)}</div></div>`;
    }).join('')}</div>`;
    view.innerHTML = `<div class="view">${h}</div>`;

    $$('[data-go]', view).forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
    $$('.slot', view).forEach(b => b.addEventListener('click', () => {
      const d = +b.dataset.day;
      const st = Core.dayStatus(S.me.record, d, S.todayDay, F());
      if (st === 'future') toast(`第 ${d} 天（${md(S.days[d - 1].date)}）還沒到喔`);
      else if (READ.includes(st)) toast(`第 ${d} 天 ${S.days[d - 1].label}：${STATUS_TEXT[st]}`);
      else go('#today/' + d);
    }));
    $('#rulesLink').addEventListener('click', e => { e.preventDefault(); openRules(); });
  }

  function openRules() {
    openSheet(`<h2>怎麼玩？</h2>
      <ul style="padding-left:20px;line-height:1.9">
        <li>每天讀完當天進度，按「我讀完了」蓋一個<b style="color:var(--seal)">紅章</b>，連勝 +1。</li>
        <li>太忙忘了？<b>7 天內補讀</b>會蓋<b style="color:var(--makeup)">橘章</b>，連勝不會斷。</li>
        <li>超過 7 天才補，會蓋<b style="color:var(--late)">灰章</b>：算進全本進度，但連勝會重新計算。</li>
        <li>每 21 天一張集點卡，集滿就換下一張。</li>
        <li>排行榜每 15 分鐘更新。個人連勝榜只公開前 10 名，你可以在個人設定選擇匿名。</li>
      </ul><button class="btn block" data-close>知道了</button>`);
  }

  // ---------- progress ----------
  function renderProgress(view) {
    const td = S.todayDay;
    const rec = S.me.record;
    const comp = Core.completion(rec, td, F());
    const st = Core.streak(rec, td, F());
    let chaptersRead = 0;
    for (let d = 1; d <= S.total; d++) if (isReadDay(d)) chaptersRead += S.days[d - 1].chapters;
    const behind = comp.elapsed - comp.done - (td >= 1 && td <= S.total && !isReadDay(td) ? 1 : 0);
    const missed = Core.missedDays(rec, td, F());

    let h = `<div class="stats" style="margin-top:12px">
      <div class="stat"><div class="v">${pct(comp.rate)}</div><div class="k">完成率（${comp.done} / ${comp.elapsed} 天）</div></div>
      <div class="stat"><div class="v">${(chaptersRead / S.totalChapters * 100).toFixed(1)}%</div><div class="k">全本進度（${chaptersRead} 章）</div></div>
      <div class="stat"><div class="v">${st.current}</div><div class="k">目前連勝</div></div>
      <div class="stat"><div class="v">${st.longest}</div><div class="k">最長連勝</div></div></div>`;
    h += `<div class="card"><h2>${behind > 0 ? `落後 ${behind} 天，慢慢補就好` : '進度剛剛好 👍'}</h2>
      <div class="heat">${S.days.map(d => `<i class="${Core.dayStatus(rec, d.day, td, F())}"></i>`).join('')}</div>
      <div class="months">${[1, 3, 5, 7, 9, 11].map(m => `<span>${m}月</span>`).join('')}</div></div>`;
    if (st.pending.length) {
      h += `<div class="section-title">待補讀（7 天內補完，連勝不斷）</div><div class="card"><ul class="todo-list">${st.pending.map(d =>
        `<li><div><div>${esc(S.days[d - 1].label)}</div><div class="when">第 ${d} 天・${md(S.days[d - 1].date)}・還剩 ${Core.MAKEUP_WINDOW - (td - d)} 天</div></div>
        <button data-go="#today/${d}">補讀</button></li>`).join('')}</ul></div>`;
    }
    if (missed.length) {
      h += `<div class="section-title">已錯過（${missed.length} 天，讀了仍會計入全本進度）</div><div class="card"><ul class="todo-list">${missed.slice(-20).reverse().map(d =>
        `<li><div><div>${esc(S.days[d - 1].label)}</div><div class="when">第 ${d} 天・${md(S.days[d - 1].date)}</div></div>
        <button data-go="#today/${d}">讀</button></li>`).join('')}</ul>
        ${missed.length > 20 ? `<p class="small muted">只列出最近 20 天</p>` : ''}</div>`;
    }
    view.innerHTML = `<div class="view">${h}</div>`;
    $$('[data-go]', view).forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  }

  // ---------- leaderboard ----------
  async function renderRank(view) {
    view.innerHTML = `<div class="view"><div class="loading">排行榜載入中…</div></div>`;
    if (!S.board || Date.now() - S.boardAt > 60000) {
      try {
        S.board = await api.leaderboard();
        S.boardAt = Date.now();
      } catch (e) {
        handleError(e);
        view.innerHTML = `<div class="view"><div class="loading">排行榜暫時載入不了，等一下再試試。</div></div>`;
        return;
      }
    }
    if (!location.hash.startsWith('#rank')) return; // user moved on while loading
    const B = S.board;
    const t = B.totals;
    const myGroup = S.me.group;
    const times = t.chapters / t.planChapters;
    let h = `<div class="card"><h2>全教會一起讀了</h2>
      <div class="big-total">${t.chapters.toLocaleString()} <span style="font-size:18px">章</span></div>
      <div class="small muted">${times >= 1 ? `相當於讀完整本聖經 ${times.toFixed(1)} 遍` : `相當於整本聖經的 ${Math.round(times * 100)}%`}・${t.members} 人參加・今天已有 <b>${t.readersToday}</b> 人蓋章</div></div>`;

    h += `<div class="section-title">小組榜（完成率）</div><div class="card"><ul class="rank-list">${B.groups.map((g, i) =>
      `<li class="group-row ${g.group === myGroup ? 'me' : ''}"><div class="r ${i < 3 ? 'top' + (i + 1) : ''}">${i + 1}</div>
        <div><div class="nm">${esc(g.group)}</div><div class="bar"><i style="width:${Math.round(g.rate * 100)}%"></i></div></div>
        <div class="val">${pct(g.rate)}<div class="sub">${g.members} 人</div></div></li>`).join('') || '<li>還沒有小組資料</li>'}</ul></div>`;

    const me = B.streakBoard.me;
    h += `<div class="section-title">個人連勝榜（前 10 名）</div><div class="card"><ul class="rank-list">${B.streakBoard.top.map(r =>
      `<li class="${r.isMe ? 'me' : ''}"><div class="r ${r.rank <= 3 ? 'top' + r.rank : ''}">${r.rank}</div>
        <div class="nm">${esc(r.name)}${r.isMe ? '（你）' : ''}</div><div class="val">${r.streak} 天</div></li>`).join('') || '<li>還沒有人上榜</li>'}</ul></div>`;
    if (me) {
      h += `<div class="card me-card"><div class="big">#${me.rank}</div><div>
        <div><b>你目前第 ${me.rank} 名</b>（連勝 ${me.streak} 天）</div>
        <div class="small muted">${me.percentile == null ? '' : `贏過 ${me.percentile}% 的弟兄姊妹`}${S.me.anonymous ? '・你在榜上顯示為匿名' : ''}</div></div></div>`;
    }
    h += `<p class="small muted" style="text-align:center">每 15 分鐘更新一次</p>`;
    view.innerHTML = `<div class="view">${h}</div>`;
  }

  // ---------- question notebook ----------
  function renderNotes(view, dayArg) {
    const last = Math.max(1, Math.min(S.todayDay, S.total));
    const sel = dayArg ? clampDay(dayArg) : last;
    const options = [];
    for (let d = last; d >= 1; d--) {
      options.push(`<option value="${d}" ${d === sel ? 'selected' : ''}>第 ${d} 天・${md(S.days[d - 1].date)}・${esc(S.days[d - 1].label)}</option>`);
    }
    let h = `<div class="card"><h2>記下不懂的地方</h2>
      <div class="field"><span>讀到哪裡</span><select id="qDay">${options.join('')}</select></div>
      <div class="field"><span>你的問題</span><textarea id="qText" maxlength="500" placeholder="例如：第 6 章說的「神的兒子們」是誰？"></textarea></div>
      <label class="check"><input type="checkbox" id="qShared" checked>讓牧師和小組長看到</label>
      <button class="btn block" id="qSave">存進疑問本</button></div>`;
    h += `<div class="section-title">我的疑問本</div><div class="card">${S.questions.length ? S.questions.map(q => `<div class="q">
        <div class="head"><span>第 ${q.day} 天・${esc(S.days[q.day - 1] ? S.days[q.day - 1].label : '')}</span><span>${q.shared ? '已分享給牧師' : '只有自己看得到'}</span></div>
        <div class="text">${esc(q.text)}</div>
        ${q.reply ? `<div class="reply"><b>牧師回覆</b>${esc(q.reply)}</div>` : ''}</div>`).join('')
      : '<p class="muted small">還沒有問題。讀經時卡住的地方記下來，小組時可以一起討論。</p>'}</div>`;
    view.innerHTML = `<div class="view">${h}</div>`;

    $('#qSave').addEventListener('click', async () => {
      const text = $('#qText').value.trim();
      if (!text) { toast('先寫下你的問題'); return; }
      const btn = $('#qSave');
      btn.disabled = true;
      try {
        const r = await api.addQuestion({ day: +$('#qDay').value, text: text, shared: $('#qShared').checked });
        S.questions = r.questions;
        toast('已存進疑問本');
        renderNotes(view, +$('#qDay').value);
      } catch (e) {
        handleError(e);
        btn.disabled = false;
      }
    });
  }

  // ---------- sheets: profile ----------
  // locked: the backdrop does not close the sheet (first-time setup must be completed).
  function openSheet(inner, locked) {
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet">${inner}</div>`;
    document.body.appendChild(bg);
    bg.addEventListener('click', e => {
      if ((e.target === bg && !locked) || e.target.hasAttribute('data-close')) bg.remove();
    });
    return bg;
  }

  function openProfile(first) {
    const me = S.me;
    let quiet = me.quietMinutes || 10;
    const bg = openSheet(`<h2>${first ? '歡迎加入 52 週讀經！' : '個人設定'}</h2>
      ${first ? `<p class="muted small">每天讀完蓋一個章，7 天內補讀連勝不會斷，21 天集滿一張集點卡。</p>` : ''}
      <div class="field"><span>暱稱（排行榜上顯示的名字）</span><input type="text" id="pName" maxlength="20" value="${esc(me.name)}"></div>
      <div class="field"><span>小組</span><select id="pGroup"><option value="">還沒有小組</option>
        ${S.groups.map(g => `<option ${g === me.group ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></div>
      <div class="field"><span>每天的安靜時間</span><div class="seg">${[5, 10, 30].map(m =>
        `<button data-q="${m}" aria-pressed="${m === quiet}">${m} 分鐘</button>`).join('')}</div></div>
      <label class="check"><input type="checkbox" id="pAnon" ${me.anonymous ? 'checked' : ''}>在個人連勝榜上匿名</label>
      <button class="btn block" id="pSave">${first ? '開始讀經' : '儲存'}</button>`, first);
    $$('[data-q]', bg).forEach(b => b.addEventListener('click', () => {
      quiet = +b.dataset.q;
      $$('[data-q]', bg).forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    }));
    $('#pSave', bg).addEventListener('click', async () => {
      const name = $('#pName', bg).value.trim();
      if (!name) { toast('請填一個暱稱'); return; }
      const btn = $('#pSave', bg);
      btn.disabled = true;
      try {
        const r = await api.saveProfile({ name: name, group: $('#pGroup', bg).value, anonymous: $('#pAnon', bg).checked, quietMinutes: quiet });
        Object.assign(S.me, r.me, { record: S.me.record });
        S.board = null;
        bg.remove();
        toast(first ? '設定完成，開始今天的讀經吧！' : '已儲存');
        render();
      } catch (e) {
        handleError(e);
        btn.disabled = false;
      }
    });
  }

  // An expired LIFF ID token comes back as 'auth': reload once to get a fresh one, but never loop.
  function handleError(e) {
    if (String(e && e.message).indexOf('auth') >= 0 && !isMock) {
      let retried = false;
      try { retried = sessionStorage.getItem('brq-auth-retry') === '1'; sessionStorage.setItem('brq-auth-retry', '1'); } catch (x) { retried = true; }
      if (!retried) { location.reload(); return true; }
      toast('登入驗證失敗，請關掉頁面重新打開', 5000);
      return false;
    }
    toast('網路有點慢，請再試一次');
    return false;
  }

  // ---------- boot ----------
  async function init() {
    restoreReaderSize();
    $$('.tabs button').forEach(b => b.addEventListener('click', () => go('#' + b.dataset.tab)));
    $('#settingsBtn').addEventListener('click', () => S.me && openProfile(false));
    try {
      if (isMock) {
        api = Api.mock({ date: params.get('date'), fresh: params.get('fresh') === '1' });
      } else {
        await loadScript('https://static.line-scdn.net/liff/edge/2/sdk.js');
        await liff.init({ liffId: CONFIG.LIFF_ID });
        if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
        params = new URLSearchParams(location.search); // LIFF may have restored deep-link params
        liffCtx = liff.getContext();
        api = Api.real(liff.getIDToken());
      }
      applyBoot(await api.bootstrap());
      try { sessionStorage.removeItem('brq-auth-retry'); } catch (x) { /* ignore */ }
      if (isMock) {
        const demo = $('#demo');
        demo.innerHTML = `示範模式・模擬日期 ${S.today}（第 ${S.todayDay} 天）・資料只存在這支手機・<a href="#" id="demoReset">重設</a>`;
        demo.classList.remove('hidden');
        $('#demoReset').addEventListener('click', e => {
          e.preventDefault();
          try { Object.keys(localStorage).filter(k => k.indexOf('brq-mock') === 0).forEach(k => localStorage.removeItem(k)); } catch (x) { /* ignore */ }
          location.replace(location.pathname + location.search);
        });
      }
      document.title = $('#title').textContent = S.plan.title || CONFIG.TITLE;
      const page = params.get('p');
      if (page && !location.hash) {
        history.replaceState(null, '', '#' + page + (params.get('day') ? '/' + params.get('day') : ''));
      }
      window.addEventListener('hashchange', render);
      render();
      if (!S.me.joined) openProfile(true);
    } catch (e) {
      console.error(e);
      if (handleError(e)) return; // reloading for a fresh login token
      $('#view').innerHTML = `<div class="card"><b>載入失敗</b><p class="muted small">${esc(e.message)}</p>
        <button class="btn block" onclick="location.reload()">重新整理</button></div>`;
    }
  }

  init();
})();
