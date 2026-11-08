// The 66 books of the Protestant canon in 和合本 order.
// code: stable 3-letter id used in plan refs and file paths; abbr: FHL short name (API `chineses` param).
// Shared by the LIFF front end, Google Apps Script and node tests (classic script + CommonJS export).
var Books = (function () {
  var GROUPS = [
    { id: 'law', name: '摩西五經' },
    { id: 'history', name: '歷史書' },
    { id: 'poetry', name: '詩歌智慧書' },
    { id: 'prophets', name: '先知書' },
    { id: 'gospels', name: '四福音' },
    { id: 'acts', name: '使徒行傳' },
    { id: 'letters', name: '書信' },
    { id: 'revelation', name: '啟示錄' },
  ];

  // [code, name, FHL abbr, chapters, group]
  var RAW = [
    ['GEN', '創世記', '創', 50, 'law'], ['EXO', '出埃及記', '出', 40, 'law'], ['LEV', '利未記', '利', 27, 'law'],
    ['NUM', '民數記', '民', 36, 'law'], ['DEU', '申命記', '申', 34, 'law'],
    ['JOS', '約書亞記', '書', 24, 'history'], ['JDG', '士師記', '士', 21, 'history'], ['RUT', '路得記', '得', 4, 'history'],
    ['1SA', '撒母耳記上', '撒上', 31, 'history'], ['2SA', '撒母耳記下', '撒下', 24, 'history'],
    ['1KI', '列王紀上', '王上', 22, 'history'], ['2KI', '列王紀下', '王下', 25, 'history'],
    ['1CH', '歷代志上', '代上', 29, 'history'], ['2CH', '歷代志下', '代下', 36, 'history'],
    ['EZR', '以斯拉記', '拉', 10, 'history'], ['NEH', '尼希米記', '尼', 13, 'history'], ['EST', '以斯帖記', '斯', 10, 'history'],
    ['JOB', '約伯記', '伯', 42, 'poetry'], ['PSA', '詩篇', '詩', 150, 'poetry'], ['PRO', '箴言', '箴', 31, 'poetry'],
    ['ECC', '傳道書', '傳', 12, 'poetry'], ['SNG', '雅歌', '歌', 8, 'poetry'],
    ['ISA', '以賽亞書', '賽', 66, 'prophets'], ['JER', '耶利米書', '耶', 52, 'prophets'], ['LAM', '耶利米哀歌', '哀', 5, 'prophets'],
    ['EZK', '以西結書', '結', 48, 'prophets'], ['DAN', '但以理書', '但', 12, 'prophets'], ['HOS', '何西阿書', '何', 14, 'prophets'],
    ['JOL', '約珥書', '珥', 3, 'prophets'], ['AMO', '阿摩司書', '摩', 9, 'prophets'], ['OBA', '俄巴底亞書', '俄', 1, 'prophets'],
    ['JON', '約拿書', '拿', 4, 'prophets'], ['MIC', '彌迦書', '彌', 7, 'prophets'], ['NAM', '那鴻書', '鴻', 3, 'prophets'],
    ['HAB', '哈巴谷書', '哈', 3, 'prophets'], ['ZEP', '西番雅書', '番', 3, 'prophets'], ['HAG', '哈該書', '該', 2, 'prophets'],
    ['ZEC', '撒迦利亞書', '亞', 14, 'prophets'], ['MAL', '瑪拉基書', '瑪', 4, 'prophets'],
    ['MAT', '馬太福音', '太', 28, 'gospels'], ['MRK', '馬可福音', '可', 16, 'gospels'], ['LUK', '路加福音', '路', 24, 'gospels'],
    ['JHN', '約翰福音', '約', 21, 'gospels'], ['ACT', '使徒行傳', '徒', 28, 'acts'],
    ['ROM', '羅馬書', '羅', 16, 'letters'], ['1CO', '哥林多前書', '林前', 16, 'letters'], ['2CO', '哥林多後書', '林後', 13, 'letters'],
    ['GAL', '加拉太書', '加', 6, 'letters'], ['EPH', '以弗所書', '弗', 6, 'letters'], ['PHP', '腓立比書', '腓', 4, 'letters'],
    ['COL', '歌羅西書', '西', 4, 'letters'], ['1TH', '帖撒羅尼迦前書', '帖前', 5, 'letters'], ['2TH', '帖撒羅尼迦後書', '帖後', 3, 'letters'],
    ['1TI', '提摩太前書', '提前', 6, 'letters'], ['2TI', '提摩太後書', '提後', 4, 'letters'], ['TIT', '提多書', '多', 3, 'letters'],
    ['PHM', '腓利門書', '門', 1, 'letters'], ['HEB', '希伯來書', '來', 13, 'letters'], ['JAS', '雅各書', '雅', 5, 'letters'],
    ['1PE', '彼得前書', '彼前', 5, 'letters'], ['2PE', '彼得後書', '彼後', 3, 'letters'], ['1JN', '約翰一書', '約一', 5, 'letters'],
    ['2JN', '約翰二書', '約二', 1, 'letters'], ['3JN', '約翰三書', '約三', 1, 'letters'], ['JUD', '猶大書', '猶', 1, 'letters'],
    ['REV', '啟示錄', '啟', 22, 'revelation'],
  ];

  var LIST = RAW.map(function (r, i) {
    return { code: r[0], name: r[1], abbr: r[2], chapters: r[3], group: r[4], order: i };
  });
  var BY_CODE = {};
  var BY_NAME = {};
  LIST.forEach(function (b) { BY_CODE[b.code] = b; BY_NAME[b.name] = b; });

  return {
    GROUPS: GROUPS,
    LIST: LIST,
    get: function (code) { return BY_CODE[code]; },
    byName: function (name) { return BY_NAME[name]; },
    groupName: function (id) {
      for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].id === id) return GROUPS[i].name;
      return id;
    },
  };
})();

if (typeof module !== 'undefined') module.exports = Books;
