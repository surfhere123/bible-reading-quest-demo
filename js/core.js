// Game rules as pure functions. Shared by the LIFF front end (mock mode), Google Apps Script and node tests.
//
// Conventions
// - Dates are 'YYYY-MM-DD' strings in church local time (Asia/Taipei); callers pass "today".
// - Plan days are 1-based. `todayDay` is the plan day number of today (may be <= 0 before launch).
// - A member's history is a record string with one char per plan day:
//     '.' not read   'o' on time   'm' makeup within MAKEUP_WINDOW days   'l' late (read after the window)
//     '-' rest day: nothing to read (補讀日 / 主日). Comes from the plan via restMask() + normalizeRecord();
//         rest days never count as pending/missed, never break a streak and are left out of completion.
// - `fromDay` is the plan day a member joined (default 1). Unread days before it are 'before':
//   they never count as pending/missed and are left out of streaks and completion rates.
var Core = (function () {
  var MAKEUP_WINDOW = 7;
  var CARD_SIZE = 21;
  var CARE_GAP = 3;
  var DAY_MS = 86400000;

  // ---------- dates ----------
  function toUTC(dateStr) {
    var p = dateStr.split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]);
  }
  function fromUTC(ms) {
    var d = new Date(ms);
    var m = d.getUTCMonth() + 1;
    var day = d.getUTCDate();
    return d.getUTCFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function addDays(dateStr, n) { return fromUTC(toUTC(dateStr) + n * DAY_MS); }
  function daysBetween(a, b) { return Math.round((toUTC(b) - toUTC(a)) / DAY_MS); }
  function dayNumber(startDate, dateStr) { return daysBetween(startDate, dateStr) + 1; }
  function dateOfDay(startDate, day) { return addDays(startDate, day - 1); }
  function weekday(dateStr) { return new Date(toUTC(dateStr)).getUTCDay(); } // 0 = Sunday

  // ---------- plan refs ----------
  // "GEN.1-3; EXO.1" -> [{book:'GEN', from:1, to:3}, {book:'EXO', from:1, to:1}]
  function parseRefs(str) {
    if (!str) return [];
    return String(str).split(/[;；]/).map(function (part) {
      var m = part.trim().match(/^([0-9A-Z]{3})\.(\d+)(?:-(\d+))?$/);
      if (!m) throw new Error('bad ref: ' + part);
      var from = +m[2];
      var to = m[3] ? +m[3] : from;
      return { book: m[1], from: from, to: to };
    });
  }
  function formatRefs(refs, Books) {
    return refs.map(function (r) {
      var name = Books ? Books.get(r.book).name : r.book;
      return name + ' ' + (r.from === r.to ? r.from : r.from + '–' + r.to);
    }).join('、');
  }
  function chapterCount(refs) {
    return refs.reduce(function (s, r) { return s + (r.to - r.from + 1); }, 0);
  }
  function groupsOf(refs, Books) {
    var seen = {};
    refs.forEach(function (r) { seen[Books.get(r.book).group] = true; });
    return Object.keys(seen);
  }
  function readingMinutes(chars, charsPerMinute) {
    return Math.max(1, Math.round(chars / (charsPerMinute || 350)));
  }

  // ---------- record string ----------
  function emptyRecord(totalDays) { return new Array(totalDays + 1).join('.'); }
  // dayChapters: array indexed by day-1 -> chapters to read that day. 0 means a rest day.
  function restMask(dayChapters) {
    return dayChapters.map(function (n) { return n > 0 ? '.' : '-'; }).join('');
  }
  // Pad/trim to the plan length and apply the rest-day mask (stamps are always kept, so a plan
  // change never loses a member's reading).
  function normalizeRecord(record, totalDays, mask) {
    record = record || '';
    if (record.length < totalDays) record += emptyRecord(totalDays - record.length);
    record = record.slice(0, totalDays);
    if (!mask) return record;
    var out = '';
    for (var i = 0; i < totalDays; i++) {
      var c = record.charAt(i);
      if (mask.charAt(i) === '-') out += isRead(c) ? c : '-';
      else out += c === '-' ? '.' : c;
    }
    return out;
  }
  function stampAt(record, day) { return record.charAt(day - 1) || '.'; }
  function isRead(ch) { return ch === 'o' || ch === 'm' || ch === 'l'; }
  function isRest(ch) { return ch === '-'; }
  function readingDays(record) {
    var n = 0;
    for (var i = 0; i < record.length; i++) if (record.charAt(i) !== '-') n++;
    return n;
  }

  function classify(lagDays) {
    if (lagDays <= 0) return 'o';
    if (lagDays <= MAKEUP_WINDOW) return 'm';
    return 'l';
  }

  // Mark `day` as read on `checkinDate`. Returns {ok, record, stamp} or {ok:false, error}.
  function checkin(record, day, checkinDate, startDate, totalDays) {
    record = normalizeRecord(record, totalDays);
    var todayDay = dayNumber(startDate, checkinDate);
    if (day < 1 || day > totalDays) return { ok: false, error: 'out-of-range' };
    if (day > todayDay) return { ok: false, error: 'future' };
    if (isRead(stampAt(record, day))) return { ok: false, error: 'already', stamp: stampAt(record, day) };
    if (isRest(stampAt(record, day))) return { ok: false, error: 'rest' };
    var stamp = classify(todayDay - day);
    return { ok: true, stamp: stamp, record: record.slice(0, day - 1) + stamp + record.slice(day) };
  }

  // Display status of one day relative to today.
  function dayStatus(record, day, todayDay, fromDay) {
    var s = stampAt(record, day);
    if (s === 'o') return 'ontime';
    if (s === 'm') return 'makeup';
    if (s === 'l') return 'late';
    if (s === '-') return 'rest';
    if (day > todayDay) return 'future';
    if (day === todayDay) return 'today';
    if (day < (fromDay || 1)) return 'before';
    if (todayDay - day <= MAKEUP_WINDOW) return 'pending';
    return 'missed';
  }

  // Streak rules: on-time and makeup days count; rest days and unread days inside the makeup
  // window ("pending") neither count nor break; today never breaks; an unread day past the window,
  // or a late ('l') day, breaks the run.
  function streak(record, todayDay, fromDay) {
    var run = 0;
    var longest = 0;
    var pending = [];
    var last = Math.min(todayDay, record.length);
    for (var d = fromDay || 1; d <= last; d++) {
      var s = stampAt(record, d);
      if (s === '-') continue;
      if (s === 'o' || s === 'm') {
        run++;
      } else if (s === '.' && (d === todayDay || todayDay - d <= MAKEUP_WINDOW)) {
        if (d !== todayDay) pending.push(d);
      } else {
        run = 0;
      }
      if (run > longest) longest = run;
    }
    return { current: run, longest: longest, pending: pending };
  }

  // done counts every read day (also ones before joining); elapsed only counts reading days since joining.
  function completion(record, todayDay, fromDay) {
    var elapsed = 0;
    var last = Math.min(todayDay, record.length);
    for (var e = fromDay || 1; e <= last; e++) if (!isRest(stampAt(record, e))) elapsed++;
    var done = 0;
    for (var d = 1; d <= record.length; d++) if (isRead(stampAt(record, d))) done++;
    return { done: done, elapsed: elapsed, rate: elapsed ? Math.min(1, done / elapsed) : 0 };
  }

  // Unread days older than the makeup window (still worth reading for completion, but won't save the streak).
  function missedDays(record, todayDay, fromDay) {
    var out = [];
    for (var d = 1; d < Math.min(todayDay, record.length + 1); d++) {
      if (dayStatus(record, d, todayDay, fromDay) === 'missed') out.push(d);
    }
    return out;
  }

  // Stamp cards of CARD_SIZE plan days each; rest days sit on the card but need no stamp.
  function cards(record, todayDay, fromDay) {
    var out = [];
    for (var from = 1; from <= record.length; from += CARD_SIZE) {
      var to = Math.min(from + CARD_SIZE - 1, record.length);
      var slots = [];
      var goal = 0;
      var filled = 0;
      for (var d = from; d <= to; d++) {
        var c = stampAt(record, d);
        if (!isRest(c)) goal++;
        if (isRead(c)) filled++;
        slots.push({ day: d, status: dayStatus(record, d, todayDay, fromDay) });
      }
      out.push({ index: out.length + 1, from: from, to: to, slots: slots, goal: goal, filled: filled, full: filled >= goal });
    }
    return out;
  }

  // ---------- badges ----------
  var BADGES = [
    { id: 'total-1', kind: 'total', n: 1, name: '第一步', desc: '第一次打卡' },
    { id: 'total-5', kind: 'total', n: 5, name: '一週同行', desc: '累積讀完 5 天' },
    { id: 'total-15', kind: 'total', n: 15, name: '習慣養成', desc: '累積讀完 15 天（3 週）' },
    { id: 'total-50', kind: 'total', n: 50, name: '五十天', desc: '累積讀完 50 天' },
    { id: 'total-100', kind: 'total', n: 100, name: '百日', desc: '累積讀完 100 天' },
    { id: 'total-200', kind: 'total', n: 200, name: '兩百天', desc: '累積讀完 200 天' },
    { id: 'total-all', kind: 'total', n: 'all', name: '全部讀完', desc: '讀完 52 週全部進度' },
    { id: 'streak-10', kind: 'streak', n: 10, name: '連勝 10 天', desc: '最長連勝達 10 天' },
    { id: 'streak-30', kind: 'streak', n: 30, name: '連勝 30 天', desc: '最長連勝達 30 天' },
    { id: 'streak-100', kind: 'streak', n: 100, name: '連勝 100 天', desc: '最長連勝達 100 天' },
  ];

  // dayGroups: array indexed by day-1 -> list of book-group ids read that day (from the plan).
  function sectionBadgeDefs(dayGroups, Books) {
    var seen = {};
    dayGroups.forEach(function (gs) { gs.forEach(function (g) { seen[g] = true; }); });
    return Books.GROUPS.filter(function (g) { return seen[g.id]; }).map(function (g) {
      return { id: 'section-' + g.id, kind: 'section', group: g.id, name: g.name, desc: '讀完' + g.name };
    });
  }

  function badges(record, todayDay, dayGroups, Books, fromDay) {
    var comp = completion(record, todayDay, fromDay);
    var st = streak(record, todayDay, fromDay);
    var earned = [];
    BADGES.forEach(function (b) {
      var n = b.n === 'all' ? readingDays(record) : b.n;
      var value = b.kind === 'total' ? comp.done : st.longest;
      if (value >= n) earned.push(b.id);
    });
    if (dayGroups && Books) {
      sectionBadgeDefs(dayGroups, Books).forEach(function (b) {
        var all = true;
        for (var d = 1; d <= record.length; d++) {
          if (dayGroups[d - 1].indexOf(b.group) >= 0 && !isRead(stampAt(record, d))) { all = false; break; }
        }
        if (all) earned.push(b.id);
      });
    }
    return earned;
  }

  function badgeDefs(dayGroups, Books) {
    return BADGES.concat(dayGroups && Books ? sectionBadgeDefs(dayGroups, Books) : []);
  }

  // ---------- members & leaderboards ----------
  // member: {id, name, group, anonymous, record, fromDay}
  function summarize(member, todayDay) {
    var st = streak(member.record, todayDay, member.fromDay);
    var comp = completion(member.record, todayDay, member.fromDay);
    return {
      id: member.id, name: member.name, group: member.group, anonymous: !!member.anonymous,
      streak: st.current, longest: st.longest, done: comp.done, elapsed: comp.elapsed, rate: comp.rate,
    };
  }

  var ANON_NAME = '匿名弟兄姊妹';

  // Top-N by current streak (ties share a rank) plus the viewer's own rank and percentile.
  function streakBoard(summaries, myId, topN) {
    topN = topN || 10;
    var sorted = summaries.slice().sort(function (a, b) {
      return b.streak - a.streak || b.done - a.done;
    });
    function rankOf(s) {
      var higher = 0;
      for (var i = 0; i < summaries.length; i++) if (summaries[i].streak > s.streak) higher++;
      return higher + 1;
    }
    var top = sorted.filter(function (s) { return s.streak > 0; }).slice(0, topN).map(function (s) {
      return { rank: rankOf(s), name: s.anonymous ? ANON_NAME : s.name, streak: s.streak, isMe: s.id === myId };
    });
    var me = null;
    var mine = summaries.filter(function (s) { return s.id === myId; })[0];
    if (mine) {
      var lower = 0;
      for (var i = 0; i < summaries.length; i++) if (summaries[i].streak < mine.streak) lower++;
      me = {
        rank: rankOf(mine),
        streak: mine.streak,
        percentile: summaries.length > 1 ? Math.round(lower / (summaries.length - 1) * 100) : null,
      };
    }
    return { top: top, me: me, total: summaries.length };
  }

  // Group completion = days read by members / sum of each member's elapsed days since joining.
  // Each member's contribution is capped at their own elapsed days so reading ahead of joining can't exceed 100%.
  function groupBoard(summaries, todayDay) {
    var by = {};
    summaries.forEach(function (s) {
      if (!s.group) return;
      var elapsed = s.elapsed != null ? s.elapsed : Math.max(0, todayDay);
      var g = by[s.group] || (by[s.group] = { group: s.group, members: 0, done: 0, elapsed: 0 });
      g.members++;
      g.done += Math.min(s.done, elapsed);
      g.elapsed += elapsed;
    });
    return Object.keys(by).map(function (k) {
      var g = by[k];
      g.rate = g.elapsed ? g.done / g.elapsed : 0;
      return g;
    }).sort(function (a, b) { return b.rate - a.rate || b.members - a.members; });
  }

  // Last reading day before `todayDay` (skips rest days), or 0 if there is none.
  function prevReadingDay(dayChapters, todayDay) {
    for (var d = Math.min(todayDay, dayChapters.length + 1) - 1; d >= 1; d--) if (dayChapters[d - 1] > 0) return d;
    return 0;
  }

  // dayChapters: array indexed by day-1 -> number of chapters that day.
  // readersPrev counts members who read the previous reading day (Friday's, on a Monday).
  function churchTotals(members, dayChapters, todayDay) {
    var chapters = 0;
    var today = 0;
    var prevReaders = 0;
    var prev = prevReadingDay(dayChapters, todayDay);
    members.forEach(function (m) {
      for (var d = 1; d <= m.record.length; d++) {
        if (isRead(stampAt(m.record, d))) chapters += dayChapters[d - 1] || 0;
      }
      if (todayDay >= 1 && isRead(stampAt(m.record, todayDay))) today++;
      if (prev && isRead(stampAt(m.record, prev))) prevReaders++;
    });
    var all = dayChapters.reduce(function (s, n) { return s + n; }, 0);
    return { chapters: chapters, readersToday: today, prevDay: prev, readersPrev: prevReaders, members: members.length, planChapters: all };
  }

  // Members with CARE_GAP or more unread reading days in a row up to yesterday (today and rest days never count).
  function needsCare(members, todayDay) {
    var out = [];
    members.forEach(function (m) {
      var gap = 0;
      for (var d = todayDay - 1; d >= (m.fromDay || 1); d--) {
        var c = stampAt(m.record, d);
        if (isRest(c)) continue;
        if (isRead(c)) break;
        gap++;
      }
      if (gap >= CARE_GAP) out.push({ id: m.id, name: m.name, group: m.group, gap: gap });
    });
    return out.sort(function (a, b) { return b.gap - a.gap; });
  }

  return {
    MAKEUP_WINDOW: MAKEUP_WINDOW, CARD_SIZE: CARD_SIZE, CARE_GAP: CARE_GAP, ANON_NAME: ANON_NAME,
    addDays: addDays, daysBetween: daysBetween, dayNumber: dayNumber, dateOfDay: dateOfDay, weekday: weekday,
    parseRefs: parseRefs, formatRefs: formatRefs, chapterCount: chapterCount, groupsOf: groupsOf,
    readingMinutes: readingMinutes,
    emptyRecord: emptyRecord, restMask: restMask, normalizeRecord: normalizeRecord, stampAt: stampAt,
    isRead: isRead, isRest: isRest, readingDays: readingDays, prevReadingDay: prevReadingDay,
    checkin: checkin, dayStatus: dayStatus, streak: streak, completion: completion, missedDays: missedDays,
    cards: cards, badges: badges, badgeDefs: badgeDefs,
    summarize: summarize, streakBoard: streakBoard, groupBoard: groupBoard, churchTotals: churchTotals,
    needsCare: needsCare,
  };
})();

if (typeof module !== 'undefined') module.exports = Core;
