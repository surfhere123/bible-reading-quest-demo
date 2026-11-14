// Backend access. Api.real talks to the Google Apps Script web app; Api.mock simulates it in the
// browser (localStorage + generated members) so every screen can be tried without LINE.
// Both return the same shapes:
//   bootstrap()            -> {today, plan:{title,start,days}, groups, me:{id,name,group,anonymous,quietMinutes,record,joined}, questions}
//   saveProfile(p)         -> {me}
//   checkin(day)           -> {ok, stamp, record} | {ok:false, error}
//   leaderboard()          -> {streakBoard, groups, totals, updatedAt}
//   addQuestion({day,text,shared}) -> {questions}
var Api = (function () {
  function real(idToken) {
    async function call(action, payload) {
      // text/plain keeps this a "simple" CORS request, which Apps Script web apps accept
      const res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action: action, idToken: idToken }, payload || {})),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    }
    return {
      bootstrap: () => call('bootstrap'),
      saveProfile: p => call('profile', p),
      checkin: day => call('checkin', { day: day }),
      leaderboard: () => call('leaderboard'),
      addQuestion: q => call('question', q),
    };
  }

  // ---------------- mock ----------------
  const GROUPS = ['喜樂組', '恩典組', '信心組', '盼望組', '青年團契'];
  const NAMES = ['小羊', 'Grace', '阿哲', '美玲', '志明', '淑芬', 'Joshua', '恩恩', '雅婷', '建宏', 'Peter', '家豪',
    '怡君', 'Hannah', '俊傑', '佩琪', '冠宇', 'Ruth', '宗翰', '欣妤', '柏翰', 'Esther', '文華', '秀英', '明德', '慧君',
    'Daniel', '品妤', '承恩', '以琳', '振宇', '曉雯', 'Samuel', '立偉', '心怡', '光耀', 'Mary', '家瑜', '子軒', '詠晴'];

  function prng(seed) { // mulberry32
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function fakeMembers(total, todayDay, mask) {
    const rnd = prng(20270101);
    return NAMES.map((name, i) => {
      const diligence = 0.35 + rnd() * 0.63;
      const quitAt = rnd() < 0.15 ? Math.floor(rnd() * 20) + 3 : Infinity;
      let rec = Core.normalizeRecord('', total, mask);
      for (let d = 1; d <= Math.min(todayDay, total); d++) {
        if (d >= quitAt) break;
        if (mask.charAt(d - 1) === '-') continue;
        const p = d === todayDay ? diligence * 0.55 : diligence;
        if (rnd() > p) continue;
        const r = rnd();
        const lag = r < 0.8 ? 0 : r < 0.95 ? 1 + Math.floor(rnd() * 4) : 8 + Math.floor(rnd() * 5);
        if (d + lag > todayDay) continue;
        rec = rec.slice(0, d - 1) + (lag === 0 ? 'o' : lag <= Core.MAKEUP_WINDOW ? 'm' : 'l') + rec.slice(d);
      }
      return { id: 'fake' + i, name: name, group: GROUPS[i % GROUPS.length], anonymous: rnd() < 0.12, record: rec, fromDay: 1 };
    });
  }

  // A history that shows every stamp type: the 6th reading day was made up, the 10th was read late
  // (which broke the streak), the reading day before yesterday's is waiting for a makeup, today is open.
  function demoRecord(total, todayDay, mask) {
    let rec = Core.normalizeRecord('', total, mask);
    const reading = [];
    for (let d = 1; d < Math.min(todayDay, total + 1); d++) if (mask.charAt(d - 1) !== '-') reading.push(d);
    const set = (d, s) => { if (d) rec = rec.slice(0, d - 1) + s + rec.slice(d); };
    reading.forEach(d => set(d, 'o'));
    set(reading[5], 'm'); set(reading[9], 'l'); set(reading[reading.length - 2], '.');
    return rec;
  }

  function mock(opts) {
    opts = opts || {};
    const today = opts.date || '2027-01-27';
    const key = 'brq-mock:' + today + (opts.fresh ? ':fresh' : '');
    let plan = null;
    let members = null;
    let me = null;
    let questions = [];
    const wait = ms => new Promise(r => setTimeout(r, ms));

    function load() {
      try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
    }
    function save() {
      try { localStorage.setItem(key, JSON.stringify({ me: me, questions: questions })); } catch (e) { /* private mode */ }
    }
    function todayDay() { return Core.dayNumber(plan.start, today); }

    return {
      async bootstrap() {
        plan = await (await fetch('data/plan.json')).json();
        const total = plan.days.length;
        const mask = Core.restMask(plan.days.map(d => d.chapters));
        members = fakeMembers(total, todayDay(), mask);
        const saved = load();
        if (saved) {
          me = saved.me; questions = saved.questions || [];
        } else if (opts.fresh) {
          me = { id: 'me', name: '示範會友', group: '', anonymous: false, quietMinutes: 10, record: '', joined: false,
            fromDay: Math.min(Math.max(todayDay(), 1), total) };
        } else {
          me = { id: 'me', name: '示範會友', group: '青年團契', anonymous: false, quietMinutes: 10, record: demoRecord(total, todayDay(), mask), joined: true, fromDay: 1 };
          questions = [{
            day: 5, text: '太 5 章說「虛心的人有福了」，虛心是什麼意思？', shared: true, at: Core.dateOfDay(plan.start, 5),
            reply: '這段很值得多想一下，主日後我們在小組一起聊聊，先繼續往下讀就好。', answered: true,
          }];
        }
        me.record = Core.normalizeRecord(me.record, total, mask);
        await wait(200);
        return { today: today, plan: plan, groups: GROUPS, me: me, questions: questions };
      },
      async saveProfile(p) {
        if (!me.joined) me.fromDay = Math.min(Math.max(todayDay(), 1), plan.days.length); // same rule as the server
        Object.assign(me, p, { joined: true });
        save();
        await wait(250);
        return { me: me };
      },
      async checkin(day) {
        const r = Core.checkin(me.record, day, today, plan.start, plan.days.length);
        if (r.ok) { me.record = r.record; save(); }
        await wait(350);
        return r;
      },
      async leaderboard() {
        const td = todayDay();
        const all = members.concat([me]).filter(m => m.joined !== false);
        const sums = all.map(m => Core.summarize(m, td));
        const dayChapters = plan.days.map(d => d.chapters);
        await wait(300);
        return {
          streakBoard: Core.streakBoard(sums, 'me', 10),
          groups: Core.groupBoard(sums, td),
          totals: Core.churchTotals(all, dayChapters, td),
          updatedAt: new Date().toISOString(),
        };
      },
      async addQuestion(q) {
        questions.unshift({ day: q.day, text: q.text, shared: q.shared, at: today, reply: '', answered: false });
        save();
        await wait(250);
        return { questions: questions };
      },
    };
  }

  return { real: real, mock: mock };
})();
