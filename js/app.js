/* 困りごと制度ガイド app.js (日英2言語・設定はヘッダー常時表示) */
(function () {
  'use strict';

  var APP_VER = '1.15';
  var ASSET_V = '1.15';   /* 旧Service Workerのcache-firstを確実に外すための版クエリ(index.html/sw.jsと揃える) */
  var EXIT_URL = 'https://www.google.com/';
  /* 🔴言語は日英のみ(2026-08-29ヒロ決定「制度が日本のものなので日本語と英語だけで良い」) */
  var LANGS = ['ja', 'en'];
  var PREF_KEY = 'seido.pref.v1';

  var D = window.SEIDO_DATA || { updated: '', categories: [], seido: [] };
  var I18N = window.SEIDO_I18N || {};
  window.SEIDO_L10N = window.SEIDO_L10N || {};

  /* ---------- 設定 ---------- */
  function loadPref() {
    var p = {};
    try { p = JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch (e) { p = {}; }
    if (LANGS.indexOf(p.lang) < 0) p.lang = detectLang();
    p.fs = (p.fs === 1 || p.fs === 2) ? p.fs : 0;
    p.bgm = (p.bgm === false) ? false : true;
    return p;
  }
  function savePref() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(pref)); } catch (e) {}
  }
  function detectLang() {
    var nav = (navigator.language || 'ja').toLowerCase().slice(0, 2);
    return LANGS.indexOf(nav) >= 0 ? nav : 'ja';
  }
  var pref = loadPref();

  /* ---------- i18n ---------- */
  function T(key) {
    var v = (I18N[pref.lang] && I18N[pref.lang][key]);
    if (v == null) v = (I18N.en && I18N.en[key]);
    if (v == null) v = (I18N.ja && I18N.ja[key]);
    return v == null ? key : v;
  }
  function TF(key, vars) {
    var s = T(key);
    Object.keys(vars || {}).forEach(function (k) {
      s = s.split('{' + k + '}').join(String(vars[k]));
    });
    return s;
  }
  /* 制度データの翻訳フィールド(なければja) */
  function L(s, field) {
    if (pref.lang !== 'ja') {
      var m = window.SEIDO_L10N[pref.lang];
      if (m && m[s.id] && m[s.id][field] != null && String(m[s.id][field]).length) return m[s.id][field];
    }
    return s[field];
  }

  var l10nLoaded = {};
  function ensureL10n(lang, cb) {
    if (lang === 'ja' || window.SEIDO_L10N[lang] || l10nLoaded[lang]) { cb(); return; }
    l10nLoaded[lang] = true;
    var sc = document.createElement('script');
    sc.src = 'js/data_' + lang + '.js?v=' + ASSET_V;
    sc.onload = cb;
    sc.onerror = cb; /* 読めない場合は日本語のまま表示 */
    document.head.appendChild(sc);
  }

  /* ---------- ユーティリティ ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(id) { return document.getElementById(id); }

  /* 👻 あとから来るクリックを捨てる(2026-09-30・Play版の指のタップで確かめた):
     pointerup で発火して画面が切り替わると、同じ指の あとから来る mousedown / mouseup / click が
     「新しい画面の同じ位置にある要素」に当たる(一覧の「もどる」で、下にあった制度カードまで開いていた)。
     bindTap が pointerup で発火したあと 700ms 以内・36px 以内の mousedown / mouseup / click を document で捨てる(click を捨てたら終わり)。
     pointer イベントは捨てないので、すぐ次のタップは今までどおり効く。支援技術(click だけ)は pointerup が無いのでここを通らない
     🔴 mousedown を捨てるとフォーカスも動かない: さがす欄に字を入れたままボタンを押しても欄が選ばれたまま=キーボードが閉じない。
     指が触れたときに選ばれていた欄が、まだ選ばれたままなら外す(捨てる前の mousedown と同じ)。押した処理が選んだ欄はそのまま */
  var GHOST_MS = 700, GHOST_PX = 36;
  var ghost = null, downFocus = null;
  function isGhost(e) {
    if (!ghost) return false;
    if (Date.now() > ghost.until) { ghost = null; return false; }
    return Math.hypot((e.clientX || 0) - ghost.x, (e.clientY || 0) - ghost.y) <= GHOST_PX;
  }
  document.addEventListener('pointerdown', function () { downFocus = document.activeElement; }, true);
  ['mousedown', 'mouseup', 'click'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      if (!isGhost(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (type === 'mousedown') {
        var a = document.activeElement;
        if (a && a === downFocus && a !== e.target && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) { try { a.blur(); } catch (_) {} }
      }
      if (type === 'click') ghost = null;
    }, true);
  });

  /* タップ方式(長押しでも発火・スクロールでは発火しない)。どのタップでもBGM開始のトリガーになる。
     🔴 pointerupだけだと、スクリーンリーダー・スイッチ操作・音声操作・キーボードが出す
        「合成click」を取りこぼして操作不能になるため、clickも購読する(直後の二重発火だけ抑える) */
  function bindTap(el, fn) {
    var sx = 0, sy = 0, active = false, lastFire = 0;
    function fire(e) {
      lastFire = Date.now();
      /* 🔴 fn(e) を先に実行してから Sound.tap() を呼ぶ。
         逆順にすると「おと なし」を押した瞬間に先に開始トリガーが走り、
         止めるつもりのタップで鳴り始めてしまう(bgmEnabled はまだ true のため) */
      fn(e);
      if (window.Sound) window.Sound.tap();
    }
    el.addEventListener('pointerdown', function (e) {
      active = true; sx = e.clientX; sy = e.clientY;
    });
    el.addEventListener('pointerup', function (e) {
      if (!active) return;
      active = false;
      if (Math.abs(e.clientX - sx) < 12 && Math.abs(e.clientY - sy) < 12) {
        var g = ghost = { x: e.clientX, y: e.clientY, until: Date.now() + GHOST_MS };   /* このあとの同じ指の click を捨てる(上の 👻) */
        try { fire(e); }
        finally {
          /* ⏱ 同じ指の click は、押した処理(fn)が終わってから届く。処理が重くて 700ms を越えると(遅い端末など)、
             付けた時刻が切れて click が通り、2回押しになる・切り替わった先の同じ位置のボタンまで押される(2026-10-01 に確かめた)。
             処理のあとで時刻を付け直す */
          var now = Date.now();
          lastFire = now;
          if (ghost === g) g.until = now + GHOST_MS;
        }
      }
    });
    el.addEventListener('pointercancel', function () { active = false; });
    el.addEventListener('click', function (e) {
      if (Date.now() - lastFire < 700) return;   /* 直前のpointerupで発火済み */
      fire(e);
    });
  }

  function seidoById(id) {
    for (var i = 0; i < D.seido.length; i++) if (D.seido[i].id === id) return D.seido[i];
    return null;
  }
  function seidoByCat(catId) {
    return D.seido.filter(function (s) { return (s.cats || []).indexOf(catId) >= 0; });
  }
  function catById(id) {
    for (var i = 0; i < D.categories.length; i++) if (D.categories[i].id === id) return D.categories[i];
    return null;
  }
  function catTitle(c) {
    var v = T('cat.' + c.id + '.title');
    return v === 'cat.' + c.id + '.title' ? c.title : v;
  }
  function catSub(c) {
    var v = T('cat.' + c.id + '.sub');
    return v === 'cat.' + c.id + '.sub' ? (c.sub || '') : v;
  }

  /* ---------- 出典(公式の情報源)・v1.8 ----------
     🔴 Play「誤解を与える表現(政府関連の情報)」(2026-09-28 v1.7 否承認): 政府関連の情報には、
        公式の情報源へのはっきりしたリンクが要る。各制度ページの上に公式ページを出し、
        ホーム・一覧・フッター(=どの画面)からも「出典の一覧」へ行けるようにする。
        組織名は出典URLのホストで引く(サブドメインは親の組織にまとめる)。url は組織のトップ(2026-09-28 全件200を実測)
        v1.15: url の末尾の / を外し(同じページ)、英語名を短くした(ストアの英語の説明文に全サイトを載せる字数のため) */
  var SRC_ORGS = [
    { host: 'mhlw.go.jp', g: 'gov', url: 'https://www.mhlw.go.jp', ja: '厚生労働省', en: 'Ministry of Health, Labour and Welfare' },
    { host: 'cfa.go.jp', g: 'gov', url: 'https://www.cfa.go.jp', ja: 'こども家庭庁', en: 'Children and Families Agency' },
    { host: 'mext.go.jp', g: 'gov', url: 'https://www.mext.go.jp', ja: '文部科学省', en: 'MEXT (Ministry of Education)' },
    { host: 'bousai.go.jp', g: 'gov', url: 'https://www.bousai.go.jp', ja: '内閣府 防災情報のページ', en: 'Cabinet Office Disaster Management' },
    { host: 'gender.go.jp', g: 'gov', url: 'https://www.gender.go.jp', ja: '内閣府 男女共同参画局', en: 'Cabinet Office Gender Equality Bureau' },
    { host: 'nta.go.jp', g: 'gov', url: 'https://www.nta.go.jp', ja: '国税庁', en: 'National Tax Agency' },
    { host: 'npa.go.jp', g: 'gov', url: 'https://www.npa.go.jp', ja: '警察庁', en: 'National Police Agency' },
    { host: 'moj.go.jp', g: 'gov', url: 'https://www.moj.go.jp', ja: '法務省', en: 'Ministry of Justice' },
    { host: 'mlit.go.jp', g: 'gov', url: 'https://www.mlit.go.jp', ja: '国土交通省', en: 'MLIT (Ministry of Transport)' },
    { host: 'fsa.go.jp', g: 'gov', url: 'https://www.fsa.go.jp', ja: '金融庁', en: 'Financial Services Agency' },
    { host: 'lfb.mof.go.jp', g: 'gov', url: 'https://lfb.mof.go.jp', ja: '財務省 財務局', en: 'MOF Local Finance Bureaus' },
    { host: 'caa.go.jp', g: 'gov', url: 'https://www.caa.go.jp', ja: '消費者庁', en: 'Consumer Affairs Agency' },
    { host: 'soumu.go.jp', g: 'gov', url: 'https://www.soumu.go.jp', ja: '総務省', en: 'MIC (Ministry of Internal Affairs)' },
    { host: 'laws.e-gov.go.jp', g: 'gov', url: 'https://laws.e-gov.go.jp', ja: 'e-Gov法令検索(デジタル庁)', en: 'e-Gov Law Search' },
    /* v1.13: DV相談＋は内閣府の事業のサイト(運営は委託先)。.jp なので、名前を付けないと下の「政府・自治体ではないページ」に入ってしまう */
    { host: 'soudanplus.jp', g: 'gov', url: 'https://soudanplus.jp', ja: '内閣府 DV相談＋', en: 'Cabinet Office DV Soudan Plus' },
    { host: 'nenkin.go.jp', g: 'pub', url: 'https://www.nenkin.go.jp', ja: '日本年金機構', en: 'Japan Pension Service' },
    { host: 'kyoukaikenpo.or.jp', g: 'pub', url: 'https://www.kyoukaikenpo.or.jp', ja: '全国健康保険協会(協会けんぽ)', en: 'Japan Health Insurance Association' },
    { host: 'jasso.go.jp', g: 'pub', url: 'https://www.jasso.go.jp', ja: '日本学生支援機構', en: 'JASSO (Student Services)' },
    { host: 'houterasu.or.jp', g: 'pub', url: 'https://www.houterasu.or.jp', ja: '日本司法支援センター(法テラス)', en: 'Japan Legal Support Center' },
    { host: 'jhf.go.jp', g: 'pub', url: 'https://www.jhf.go.jp', ja: '住宅金融支援機構', en: 'Japan Housing Finance Agency' },
    { host: 'jfc.go.jp', g: 'pub', url: 'https://www.jfc.go.jp', ja: '日本政策金融公庫', en: 'Japan Finance Corporation' },
    { host: 'kokusen.go.jp', g: 'pub', url: 'https://www.kokusen.go.jp', ja: '国民生活センター', en: 'National Consumer Affairs Center' },
    { host: 'wam.go.jp', g: 'pub', url: 'https://www.wam.go.jp', ja: '福祉医療機構', en: 'Welfare and Medical Service Agency' },
    { host: 'shakyo.or.jp', g: 'pub', url: 'https://www.shakyo.or.jp', ja: '全国社会福祉協議会', en: 'National Council of Social Welfare' },
    { host: 'johas.go.jp', g: 'pub', url: 'https://www.johas.go.jp', ja: '労働者健康安全機構', en: 'JOHAS (Occupational Health)' },
    { host: 'rehab.go.jp', g: 'pub', url: 'https://www.rehab.go.jp', ja: '国立障害者リハビリテーションセンター', en: 'National Rehabilitation Center' },
    { host: 'ncnp.go.jp', g: 'pub', url: 'https://www.ncnp.go.jp', ja: '国立精神・神経医療研究センター', en: 'NCNP (Neurology and Psychiatry)' },
    { host: 'nanbyou.or.jp', g: 'pub', url: 'https://www.nanbyou.or.jp', ja: '難病情報センター', en: 'Intractable Diseases Info Center' },
    { host: 'shouman.jp', g: 'pub', url: 'https://www.shouman.jp', ja: '小児慢性特定疾病情報センター', en: 'Pediatric Chronic Diseases Info Center' },
    /* v1.14(2026-10-02 4回目の否承認・指摘の画面=出典の一覧のいちばん下=会社・団体のページ): 出典は国・公的機関・自治体だけにした。
       自治体もホスト名だけでなく名前を出す(トップページは 2026-10-02 に全件200を実測。.lg.jp でない市の公式ドメインもあるため) */
{ host: 'city.kawasaki.jp', g: 'local', url: 'https://www.city.kawasaki.jp', ja: '川崎市', en: 'Kawasaki City' },
    { host: 'pref.hokkaido.lg.jp', g: 'local', url: 'https://www.pref.hokkaido.lg.jp', ja: '北海道', en: 'Hokkaido Government' },
    { host: 'pref.ishikawa.lg.jp', g: 'local', url: 'https://www.pref.ishikawa.lg.jp', ja: '石川県', en: 'Ishikawa Prefecture' },
    { host: 'city.taito.lg.jp', g: 'local', url: 'https://www.city.taito.lg.jp', ja: '台東区(東京都)', en: 'Taito City, Tokyo' },
    { host: 'pref.tokushima.lg.jp', g: 'local', url: 'https://www.pref.tokushima.lg.jp', ja: '徳島県', en: 'Tokushima Prefecture' },
    { host: 'city.sakai.lg.jp', g: 'local', url: 'https://www.city.sakai.lg.jp', ja: '堺市', en: 'Sakai City' },
    { host: 'town.ojika.lg.jp', g: 'local', url: 'https://www.town.ojika.lg.jp', ja: '小値賀町(長崎県)', en: 'Ojika Town, Nagasaki' },
    { host: 'city.chiba.jp', g: 'local', url: 'https://www.city.chiba.jp', ja: '千葉市', en: 'Chiba City' },
    { host: 'city.kagoshima.lg.jp', g: 'local', url: 'https://www.city.kagoshima.lg.jp', ja: '鹿児島市', en: 'Kagoshima City' },
    { host: 'city.kitakyushu.lg.jp', g: 'local', url: 'https://www.city.kitakyushu.lg.jp', ja: '北九州市', en: 'Kitakyushu City' },
    { host: 'pref.chiba.lg.jp', g: 'local', url: 'https://www.pref.chiba.lg.jp', ja: '千葉県', en: 'Chiba Prefecture' },
    { host: 'city.chuo.lg.jp', g: 'local', url: 'https://www.city.chuo.lg.jp', ja: '中央区(東京都)', en: 'Chuo City, Tokyo' },
    { host: 'pref.osaka.lg.jp', g: 'local', url: 'https://www.pref.osaka.lg.jp', ja: '大阪府', en: 'Osaka Prefecture' },
    { host: 'city.kobe.lg.jp', g: 'local', url: 'https://www.city.kobe.lg.jp', ja: '神戸市', en: 'Kobe City' },
    { host: 'fukushi.metro.tokyo.lg.jp', g: 'local', url: 'https://www.fukushi.metro.tokyo.lg.jp', ja: '東京都 福祉局', en: 'Tokyo Metropolitan Government (Social Welfare)' },
    { host: 'city.osaka.lg.jp', g: 'local', url: 'https://www.city.osaka.lg.jp', ja: '大阪市', en: 'Osaka City' },
    { host: 'hokeniryo.metro.tokyo.lg.jp', g: 'local', url: 'https://www.hokeniryo.metro.tokyo.lg.jp', ja: '東京都 保健医療局', en: 'Tokyo Metropolitan Government (Public Health)' },
    { host: 'city.yokohama.lg.jp', g: 'local', url: 'https://www.city.yokohama.lg.jp', ja: '横浜市', en: 'Yokohama City' },
    { host: 'city.nagasaki.lg.jp', g: 'local', url: 'https://www.city.nagasaki.lg.jp', ja: '長崎市', en: 'Nagasaki City' },
    { host: 'pref.fukuoka.lg.jp', g: 'local', url: 'https://www.pref.fukuoka.lg.jp', ja: '福岡県', en: 'Fukuoka Prefecture' },
    { host: 'city.himeji.lg.jp', g: 'local', url: 'https://www.city.himeji.lg.jp', ja: '姫路市', en: 'Himeji City' },
    { host: 'web.pref.hyogo.lg.jp', g: 'local', url: 'https://web.pref.hyogo.lg.jp', ja: '兵庫県', en: 'Hyogo Prefecture' },
    { host: 'city.kyoto.lg.jp', g: 'local', url: 'https://www.city.kyoto.lg.jp', ja: '京都市', en: 'Kyoto City' },
    { host: 'city.sapporo.jp', g: 'local', url: 'https://www.city.sapporo.jp', ja: '札幌市', en: 'Sapporo City' },
    { host: 'city.sakuragawa.lg.jp', g: 'local', url: 'https://www.city.sakuragawa.lg.jp', ja: '桜川市(茨城県)', en: 'Sakuragawa City, Ibaraki' },
    { host: 'city.omitama.lg.jp', g: 'local', url: 'https://www.city.omitama.lg.jp', ja: '小美玉市(茨城県)', en: 'Omitama City, Ibaraki' },
    { host: 'city.kita.lg.jp', g: 'local', url: 'https://www.city.kita.lg.jp', ja: '北区(東京都)', en: 'Kita City, Tokyo' },
    { host: 'city.koto.lg.jp', g: 'local', url: 'https://www.city.koto.lg.jp', ja: '江東区(東京都)', en: 'Koto City, Tokyo' },
    { host: 'city.nagahama.lg.jp', g: 'local', url: 'https://www.city.nagahama.lg.jp', ja: '長浜市(滋賀県)', en: 'Nagahama City, Shiga' },
    { host: 'pref.aichi.jp', g: 'local', url: 'https://www.pref.aichi.jp', ja: '愛知県', en: 'Aichi Prefecture' },
    { host: 'city.hiroshima.lg.jp', g: 'local', url: 'https://www.city.hiroshima.lg.jp', ja: '広島市', en: 'Hiroshima City' },
    { host: 'city.matsusaka.mie.jp', g: 'local', url: 'https://www.city.matsusaka.mie.jp', ja: '松阪市(三重県)', en: 'Matsusaka City, Mie' },
    { host: 'city.moriguchi.osaka.jp', g: 'local', url: 'https://www.city.moriguchi.osaka.jp', ja: '守口市(大阪府)', en: 'Moriguchi City, Osaka' },
    { host: 'pref.saga.lg.jp', g: 'local', url: 'https://www.pref.saga.lg.jp', ja: '佐賀県', en: 'Saga Prefecture' },
    { host: 'city.toshima.lg.jp', g: 'local', url: 'https://www.city.toshima.lg.jp', ja: '豊島区(東京都)', en: 'Toshima City, Tokyo' },
    { host: 'city.sendai.jp', g: 'local', url: 'https://www.city.sendai.jp', ja: '仙台市', en: 'Sendai City' },
    { host: 'city.akashi.lg.jp', g: 'local', url: 'https://www.city.akashi.lg.jp', ja: '明石市(兵庫県)', en: 'Akashi City, Hyogo' },
    { host: 'city.tachikawa.lg.jp', g: 'local', url: 'https://www.city.tachikawa.lg.jp', ja: '立川市(東京都)', en: 'Tachikawa City, Tokyo' },
    { host: 'city.shinjuku.lg.jp', g: 'local', url: 'https://www.city.shinjuku.lg.jp', ja: '新宿区(東京都)', en: 'Shinjuku City, Tokyo' },
    { host: 'city.tama.lg.jp', g: 'local', url: 'https://www.city.tama.lg.jp', ja: '多摩市(東京都)', en: 'Tama City, Tokyo' },
    { host: 'tax.metro.tokyo.lg.jp', g: 'local', url: 'https://www.tax.metro.tokyo.lg.jp', ja: '東京都 主税局', en: 'Tokyo Metropolitan Government (Taxation)' },
    { host: 'town.haboro.lg.jp', g: 'local', url: 'https://www.town.haboro.lg.jp', ja: '羽幌町(北海道)', en: 'Haboro Town, Hokkaido' },
    { host: 'city.saitama.lg.jp', g: 'local', url: 'https://www.city.saitama.lg.jp', ja: 'さいたま市', en: 'Saitama City' },
    { host: 'pref.okinawa.jp', g: 'local', url: 'https://www.pref.okinawa.jp', ja: '沖縄県', en: 'Okinawa Prefecture' }
  ];
  var SRC_GROUPS = ['gov', 'pub', 'local', 'other'];
  function hostOf(u) {
    var m = /^https?:\/\/([^\/?#:]+)/i.exec(String(u || ''));
    return m ? m[1].toLowerCase() : '';
  }
  function orgOf(host) {
    for (var i = 0; i < SRC_ORGS.length; i++) {
      var h = SRC_ORGS[i].host;
      if (host === h || host.slice(-(h.length + 1)) === '.' + h) return SRC_ORGS[i];
    }
    return null;
  }
  function isLocalHost(h) {
    return /\.lg\.jp$/.test(h) || /(^|\.)(pref|city|town|vill)\.[a-z0-9-]+\.([a-z0-9-]+\.)?jp$/.test(h);
  }
  function orgName(o) { return pref.lang === 'ja' ? o.ja : o.en; }
  /* 出典の分け方: gov / pub / local / other(other=政府・自治体のサイトではない会社・団体のページ) */
  function srcGroup(u) {
    var h = hostOf(u), o = orgOf(h);
    return o ? o.g : (isLocalHost(h) ? 'local' : 'other');
  }
  /* 制度ページの上に出す1本 = 国の機関・公的機関 → 自治体 → それ以外 の順で最初のもの
     🔴 v1.13(2026-10-01 3回目の否承認「政府関連の情報の情報源のリンクがない」・指摘の画面=出典の一覧の「そのほかの公式サイト」):
        どの制度も政府・自治体の出典を最低1本持つ(_smoke.js [12])。会社・団体のページを「公式」として先頭に出さない */
  function primarySource(s) {
    var list = s.sources || [], best = null, br = 9;
    var RANK = { gov: 0, pub: 0, local: 1, other: 2 };
    for (var i = 0; i < list.length; i++) {
      var r = RANK[srcGroup(list[i].url)];
      if (r < br) { br = r; best = list[i]; }
    }
    return best;
  }

  function renderSources() {
    var groups = { gov: {}, pub: {}, local: {}, other: {} };
    D.seido.forEach(function (s) {
      (s.sources || []).forEach(function (src) {
        var h = hostOf(src.url);
        if (!h) return;
        var o = orgOf(h);
        var g = o ? o.g : (isLocalHost(h) ? 'local' : 'other');
        var key = o ? o.host : h;
        var e = groups[g][key] || (groups[g][key] = { o: o, host: h, url: o ? o.url : src.url, ids: {} });
        e.ids[s.id] = 1;
      });
    });
    /* 🔴🔴 v1.15(2026-10-02 5回目の否承認「情報源の提供が不十分」・指摘=英語の詳しい説明): 説明文の自治体が「例」の3つだけで、
       この一覧と合わなかった。この一覧の並び(制度の数の多い順)と数は、ストアの説明文(store/_listing.js が作る)と同じにする */
    var total = 0;
    SRC_GROUPS.forEach(function (g) { total += Object.keys(groups[g]).length; });
    var html = '<h2 id="src-title" class="list-title">' + esc(T('src.title')) + '</h2>';
    html += '<p class="src-intro">' + esc(TF('src.intro', { n: total })) + '</p>';
    /* ストアの説明文の話は Play版だけ(Web版にはストアの説明文が無い) */
    if (isNativeApp()) html += '<p class="src-intro">' + esc(TF('src.store', { n: total })) + '</p>';
    html += '<p class="src-indep">' + esc(T('f.disclaimer')) + '</p>';
    SRC_GROUPS.forEach(function (g) {
      var items = Object.keys(groups[g]).map(function (k) { return groups[g][k]; });
      if (!items.length) return;
      items.sort(function (a, b) { return Object.keys(b.ids).length - Object.keys(a.ids).length; });
      html += '<div class="src-group"><h3>' + esc(TF('src.groupHead', { t: T('src.' + g), n: items.length })) + '</h3>';
      if (g === 'local' || g === 'other') html += '<p class="src-note">' + esc(T('src.' + g + 'Note')) + '</p>';
      html += '<ul>';
      items.forEach(function (e) {
        var n = Object.keys(e.ids).length;
        html += '<li>';
        if (e.o) html += '<span class="src-name">' + esc(orgName(e.o)) + '</span> ';
        html += '<a href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(e.o ? e.url : e.host) + '</a>';
        html += ' <span class="src-count">' + esc(TF('src.count', { n: n })) + '</span></li>';
      });
      html += '</ul></div>';
    });
    $('src-body').innerHTML = html;
    show('view-src');
  }

  /* ---------- 画面切替(hashルーティング) ---------- */
  var firstShow = true;
  function show(viewId) {
    ['view-home', 'view-list', 'view-detail', 'view-src'].forEach(function (v) {
      $(v).hidden = (v !== viewId);
    });
    window.scrollTo(0, 0);
    /* 画面が切り替わったことをスクリーンリーダーにも伝えるため、その画面の見出しへ移す
       (初回描画では利用者のフォーカスを奪わない) */
    if (firstShow) { firstShow = false; return; }
    var target = viewId === 'view-list' ? $('list-title')
      : viewId === 'view-detail' ? document.querySelector('#detail-body .d-name')
        : viewId === 'view-src' ? $('src-title')
          : $('home-pick');
    if (target) {
      target.setAttribute('tabindex', '-1');
      try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    }
  }

  function route() {
    var h = location.hash || '#home';
    if (h.indexOf('#c/') === 0) { renderList(decodeURIComponent(h.slice(3)), null); return; }
    if (h.indexOf('#q/') === 0) { renderList(null, decodeURIComponent(h.slice(3))); return; }
    if (h.indexOf('#s/') === 0) { renderDetail(decodeURIComponent(h.slice(3))); return; }
    if (h === '#src') { renderSources(); return; }
    show('view-home');
  }

  function go(hash) {
    if (location.hash === hash) { route(); } else { location.hash = hash; }
  }
  /* 画面の「← もどる」(data-back)と、Android の戻るボタンの行き先(同じ) */
  function goBack() {
    if (history.length > 1) history.back(); else go('#home');
  }

  /* ---------- Android の戻るボタン(Play版だけ・2026-09-30) ----------
     @capacitor/app が無いと、戻るを押すとアプリごと後ろに下がっていた(Android 11 以前は閉じる)。
     一覧・詳しい表示・出典の一覧 → 画面の「← もどる」と同じ(来た画面へ)/ ホーム → アプリを後ろに下げる(minimizeApp。中身はそのまま)。
     重ねた窓・書きかけの欄(さがす欄は数えない)・確かめの窓は、このアプリには無い。
     🔴 プラグインはネイティブが注入する Capacitor.Plugins.App を使う(registerPlugin は WebView に無い)。
     Web版(ブラウザ)は何も変えない(戻るはブラウザのまま) */
  function isNativeApp() {
    try { var c = window.Capacitor; return !!(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform()); } catch (e) { return false; }
  }
  function nativePlugin(name, fn) {
    try {
      var c = window.Capacitor;
      if (typeof c.isPluginAvailable === 'function' && !c.isPluginAvailable(name)) return null;
      var p = c.Plugins && c.Plugins[name];
      return (p && typeof p[fn] === 'function') ? p : null;
    } catch (e) { return null; }
  }
  function minimizeApp() {
    var ap = nativePlugin('App', 'minimizeApp');
    try { if (ap) { var p = ap.minimizeApp(); if (p && p.catch) p.catch(function () {}); } } catch (e) {}
  }
  function onBackButton() {
    if (guideOv) { guideOv._back(); return; }   /* はじめての つかいかた(下の節) */
    if (!$('view-home').hidden) { minimizeApp(); return; }
    goBack();
  }
  function watchBack() {
    if (!isNativeApp()) return;
    var ap = nativePlugin('App', 'addListener');
    if (!ap) return;
    try { ap.addListener('backButton', function () { onBackButton(); }); } catch (e) {}
  }

  /* ---------- はじめての つかいかた(初回の案内・2026-09-30) ----------
     ヒロさん「ひとつずつ・そよぎ みたいなタイプのアプリは、必ず最初に使い方の丁寧な説明を出してほしい。10代の情報室のように」。
     ・初回起動で必ず出す(最後まで読むまで、開くたびに出る)。文言は i18n の guide.*(heads / bodies は同じ数)
     ・1ページずつ「つぎ」「まえ」で進む。閉じるのは最後のページの「はじめる」だけ(× は置かない)
     ・🔴 ヘッダー(ことば・もじ・おと・× とじる)は押せるまま、その下を全部おおう。
       「× とじる」(すぐに別のページへ)は案内のあいだも使える。ことば・もじ を変えると案内もその場で変わる
     ・戻るボタン(Play版): 2ページ目から=まえのページ / 1ページ目=初回なら後ろに下げる(閉じない)、
       画面のいちばん下の「つかいかたを もう一度 見る」から開いたときは閉じる
     ・読み終えたら localStorage の seido.guide.v1 = true
     ・🔴 案内は画面の使い方だけ。制度の中身・効果・受けられるかどうかは書かない(Play「誤解を与える表現」) */
  var GUIDE_KEY = 'seido.guide.v1';
  var guideOv = null;
  function guideDone() {
    try { return JSON.parse(localStorage.getItem(GUIDE_KEY)) === true; } catch (e) { return false; }
  }
  function guideEl(tag, cls) { var e = document.createElement(tag); e.className = cls; return e; }
  /* 案内の上端=ヘッダーの下端(ヘッダーは sticky で いつも いちばん上) */
  function placeGuide() {
    if (!guideOv) return;
    var h = document.querySelector('.app-header');
    guideOv.style.top = (h ? Math.round(h.getBoundingClientRect().height) : 0) + 'px';
  }
  function setGuideInert(on) {
    /* 案内の下の画面は、読み上げ・キーボードでも届かないようにする(ヘッダーは届く) */
    ['main', '.app-footer'].forEach(function (s) {
      var e = document.querySelector(s);
      if (e) { e.inert = !!on; if (on) e.setAttribute('aria-hidden', 'true'); else e.removeAttribute('aria-hidden'); }
    });
  }
  function openGuide(first) {
    if (guideOv) return;
    var bodies = T('guide.bodies');
    if (!Array.isArray(bodies) || !bodies.length) return;
    var i = 0;
    var ov = guideEl('div', 'guide-ov');
    ov.setAttribute('role', 'dialog');
    var box = guideEl('div', 'guide-box');
    var top = guideEl('div', 'guide-top');
    var ttl = guideEl('p', 'guide-title');
    var step = guideEl('p', 'guide-step');
    top.appendChild(ttl); top.appendChild(step);
    var h = guideEl('h2', 'guide-h');
    var p = guideEl('p', 'guide-p');
    var dots = guideEl('div', 'guide-dots');
    dots.setAttribute('aria-hidden', 'true');
    var row = guideEl('div', 'guide-row');
    var prevB = guideEl('button', 'guide-prev');
    var nextB = guideEl('button', 'guide-next');
    prevB.type = 'button'; nextB.type = 'button';
    row.appendChild(prevB); row.appendChild(nextB);
    box.appendChild(top); box.appendChild(h); box.appendChild(p); box.appendChild(dots);
    ov.appendChild(box); ov.appendChild(row);
    function draw() {
      var heads = T('guide.heads');
      bodies = T('guide.bodies');                 /* ことばを変えたときも、いまのページのまま訳し直す */
      var n = bodies.length;
      if (i > n - 1) i = n - 1;
      ov.setAttribute('aria-label', T('guide.title'));
      ttl.textContent = T('guide.title');
      step.textContent = String(T('guide.step')).replace('{n}', i + 1).replace('{m}', n);
      step.setAttribute('dir', 'ltr');            /* 「1 / 7」は いつも左から */
      h.textContent = (Array.isArray(heads) && heads[i]) ? heads[i] : '';
      p.textContent = bodies[i];
      dots.innerHTML = '';
      for (var k = 0; k < n; k++) dots.appendChild(guideEl('span', 'guide-dot' + (k === i ? ' on' : '')));
      prevB.textContent = T('guide.prev');
      prevB.style.visibility = (i === 0) ? 'hidden' : 'visible';   /* 「つぎ」の位置を変えない */
      nextB.textContent = (i === n - 1) ? T('guide.start') : T('guide.next');
      ov.scrollTop = 0;
      placeGuide();
    }
    function close() {
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      guideOv = null;
      setGuideInert(false);
      try { localStorage.setItem(GUIDE_KEY, 'true'); } catch (e) {}
    }
    ov._draw = draw;
    ov._back = function () {
      if (i > 0) { i--; draw(); return; }
      if (first) minimizeApp(); else close();
    };
    bindTap(prevB, function () { if (i > 0) { i--; draw(); } });
    bindTap(nextB, function () { if (i < bodies.length - 1) { i++; draw(); } else close(); });
    guideOv = ov;
    document.body.appendChild(ov);
    setGuideInert(true);
    draw();
    /* 読み上げに案内の始まりを伝える(画面切替の show() と同じく見出しへ。枠は出さない=style.css) */
    h.setAttribute('tabindex', '-1');
    try { h.focus({ preventScroll: true }); } catch (e) {}
  }

  /* ---------- ホーム ---------- */
  function renderHome() {
    var grid = $('cat-grid');
    grid.innerHTML = '';
    D.categories.forEach(function (c) {
      var n = seidoByCat(c.id).length;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat-card';
      b.innerHTML =
        '<span class="cat-icon">' + esc(c.icon) + '</span>' +
        '<span class="cat-name">' + esc(catTitle(c)) + '</span>' +
        '<span class="cat-count">' + esc(TF('home.count', { n: n })) + '</span>';
      bindTap(b, function () { go('#c/' + encodeURIComponent(c.id)); });
      grid.appendChild(b);
    });
  }

  /* ---------- 一覧(カテゴリ or 検索) ---------- */
  function searchHay(s) {
    /* 表示言語と日本語の両方から検索できるようにする */
    var parts = [s.name, s.short, s.target, s.benefit, (s.keywords || []).join(' ')];
    if (pref.lang !== 'ja') {
      parts.push(L(s, 'name'), L(s, 'short'), L(s, 'target'), L(s, 'benefit'));
    }
    return parts.join(' ').toLowerCase();
  }

  function renderList(catId, query) {
    var items, title, sub;
    if (catId) {
      var c = catById(catId);
      if (!c) { go('#home'); return; }
      items = seidoByCat(catId);
      title = c.icon + ' ' + catTitle(c);
      sub = catSub(c);
    } else {
      var q = (query || '').trim().toLowerCase();
      items = D.seido.filter(function (s) {
        var hay = searchHay(s);
        return q.split(/\s+/).every(function (w) { return w === '' || hay.indexOf(w) >= 0; });
      });
      title = TF('list.result', { q: query });
      sub = TF('list.found', { n: items.length });
    }
    $('list-title').textContent = title;
    $('list-sub').textContent = sub;
    var wrap = $('seido-list');
    wrap.innerHTML = '';
    if (items.length === 0) {
      wrap.innerHTML = '<p class="list-sub">' + esc(T('list.none')) + '</p>';
    }
    items.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'seido-card';
      b.innerHTML =
        '<span class="s-name">' + esc(L(s, 'name')) + '</span>' +
        '<span class="s-short">' + esc(L(s, 'short')) + '</span>' +
        '<span class="s-window">' + esc(TF('list.window', { w: L(s, 'window') })) + '</span>';
      bindTap(b, function () { go('#s/' + encodeURIComponent(s.id)); });
      wrap.appendChild(b);
    });
    show('view-list');
  }

  /* ---------- 詳細 ---------- */
  function listHtml(arr, cls) {
    if (!arr || !arr.length) return '<p>' + esc(T('d.none')) + '</p>';
    return '<ul class="' + (cls || '') + '">' + arr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
  }
  function stepsHtml(arr) {
    if (!arr || !arr.length) return '<p>' + esc(T('d.none')) + '</p>';
    return '<ol>' + arr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>';
  }
  function lArr(s, field) {
    if (pref.lang !== 'ja') {
      var m = window.SEIDO_L10N[pref.lang];
      if (m && m[s.id] && Array.isArray(m[s.id][field]) && m[s.id][field].length === (s[field] || []).length) {
        return m[s.id][field];
      }
    }
    return s[field] || [];
  }

  function renderDetail(id) {
    var s = seidoById(id);
    if (!s) { go('#home'); return; }
    var checked = (s.sources && s.sources[0] && s.sources[0].checked) || D.updated;
    var html = '';
    html += '<h2 class="d-name">' + esc(L(s, 'name')) + '</h2>';
    if (pref.lang !== 'ja') {
      html += '<p class="d-official">' + esc(TF('d.officialName', { n: s.name })) + '</p>';
    }
    /* 公式の情報源を最初に見える位置に(一番下の出典一覧とは別に) */
    var ps = primarySource(s);
    if (ps) {
      var po = orgOf(hostOf(ps.url));
      /* 英語で組織表に無い出典(自治体など)は、ホストを2回並べず URL をそのまま出す */
      var pText = pref.lang === 'ja' ? ps.title : (po ? po.en : ps.url);
      html += '<p class="d-src-top"><span class="d-src-label">' + esc(T('d.srcTop')) + '</span> ' +
        '<a href="' + esc(ps.url) + '" target="_blank" rel="noopener">' + esc(pText) + '</a>' +
        (pText === ps.url ? '' : ' <span class="d-src-host">(' + esc(hostOf(ps.url)) + ')</span>') + '</p>';
    }
    html += '<p class="d-short">' + esc(L(s, 'short')) + '</p>';
    var recent = L(s, 'recent');
    if (recent) html += '<div class="d-recent">' + esc(TF('d.recent', { t: recent })) + '</div>';
    html += '<div class="d-sec"><h3>' + esc(T('d.what')) + '</h3><p>' + esc(L(s, 'benefit')) + '</p></div>';
    html += '<div class="d-sec"><h3>' + esc(T('d.target')) + '</h3><p>' + esc(L(s, 'target')) + '</p></div>';
    html += '<div class="d-sec"><h3>' + esc(T('d.window')) + '</h3><div class="d-window-box">' + esc(L(s, 'window'));
    if (s.phone) html += '<div class="d-phone">' + esc(s.phone) + '</div>';
    html += '</div></div>';
    html += '<div class="d-sec"><h3>' + esc(T('d.docs')) + '</h3>' + listHtml(lArr(s, 'documents')) + '</div>';
    html += '<div class="d-sec"><h3>' + esc(T('d.steps')) + '</h3>' + stepsHtml(lArr(s, 'steps')) + '</div>';
    var notes = lArr(s, 'notes');
    if (notes.length) {
      html += '<div class="d-sec"><h3>' + esc(T('d.notes')) + '</h3>' + listHtml(notes, 'd-notes') + '</div>';
    }
    html += '<div class="d-sources"><h3>' + esc(T('d.sources')) + '</h3><ul>';
    (s.sources || []).forEach(function (src) {
      html += '<li>' + esc(src.title) + ' <a href="' + esc(src.url) + '" target="_blank" rel="noopener">' + esc(src.url) + '</a>' +
        (srcGroup(src.url) === 'other' ? ' <span class="d-src-nongov">' + esc(T('d.srcNonGov')) + '</span>' : '') + '</li>';
    });
    html += '</ul><p class="d-checked">' + esc(TF('d.checked', { d: checked })) + '</p></div>';
    html += '<p class="d-disclaimer">' + esc(T('d.disclaimer')) + '</p>';
    $('detail-body').innerHTML = html;
    show('view-detail');
  }

  /* ---------- 表示言語・文字サイズ・音の適用 ---------- */
  function applyStatic() {
    document.documentElement.lang = pref.lang;
    document.body.setAttribute('data-fs', String(pref.fs));

    document.title = T('app.name');
    $('app-title').textContent = T('app.name');
    $('app-sub').textContent = T('app.tagline');
    /* 🔴 可視テキストをそのままアクセシブル名にする(音声操作で「とじる」と言って押せるように)。
       aria-labelで別の文言に置き換えるとWCAG 2.5.3 Label in Nameに反する */
    $('btn-exit').textContent = T('header.close');
    $('btn-exit').setAttribute('title', T('header.closeAria'));
    $('search-input').placeholder = T('search.placeholder');
    $('search-input').setAttribute('aria-label', T('search.aria'));
    $('btn-search').textContent = T('search.button');
    $('home-pick').textContent = T('home.pick');
    $('home-note-text').textContent = T('home.note');
    $('home-src-text').textContent = T('home.srcText');
    $('home-src-link').textContent = T('home.srcLink');
    $('list-src-link').textContent = T('list.srcLink');
    $('footer-src').textContent = T('f.sources');
    $('footer-guide').textContent = T('guide.again');
    document.querySelectorAll('[data-back]').forEach(function (b) { b.textContent = T('back'); });
    $('footer-updated').textContent = TF('f.baseDate', { d: D.updated });
    $('footer-disclaimer').textContent = T('f.disclaimer');
    $('footer-credit').textContent = T('f.credit');
    $('footer-ver').textContent = 'VER ' + APP_VER;

    /* ヘッダーの設定 */
    $('set-lang').setAttribute('aria-label', T('set.lang'));
    $('set-lang').value = pref.lang;
    $('set-fs-label').textContent = T('set.fs');
    var fsNames = [T('set.fsNormal'), T('set.fsLarge'), T('set.fsXL')];
    document.querySelectorAll('.set-fs-btn').forEach(function (b) {
      var n = Number(b.getAttribute('data-fs')) || 0;
      b.textContent = T('set.fsGlyph');
      /* 可視文字(あ/A)を名前の先頭に含める(Label in Name) */
      b.setAttribute('aria-label', T('set.fsGlyph') + ' ' + fsNames[n]);
      b.setAttribute('title', T('set.fs') + ': ' + fsNames[n]);
      b.setAttribute('aria-pressed', String(n === pref.fs));
      b.classList.toggle('on', n === pref.fs);
    });
    applyBgmLabel();
    if (guideOv) guideOv._draw();   /* はじめての つかいかた も、ことば・もじ に合わせて描き直す */
  }

  function applyBgmLabel() {
    var b = $('btn-bgm');
    /* 可視テキスト(おと あり/なし)をそのままアクセシブル名にする(Label in Name) */
    $('bgm-label').textContent = pref.bgm ? T('set.soundOn') : T('set.soundOff');
    b.setAttribute('aria-pressed', String(!!pref.bgm));
    b.setAttribute('title', T('set.sound'));
    b.classList.toggle('on', !!pref.bgm);
  }

  function rerenderAll() {
    applyStatic();
    renderHome();
    route();
  }

  function setLang(lang) {
    pref.lang = LANGS.indexOf(lang) >= 0 ? lang : 'ja';
    savePref();
    ensureL10n(pref.lang, rerenderAll);
  }

  /* ---------- 初期化 ---------- */
  function init() {
    bindTap($('btn-exit'), function () { location.replace(EXIT_URL); });

    $('set-lang').addEventListener('change', function () {
      if (window.Sound) window.Sound.tap();
      setLang(this.value);
    });

    document.querySelectorAll('.set-fs-btn').forEach(function (b) {
      bindTap(b, function () {
        pref.fs = Number(b.getAttribute('data-fs')) || 0;
        savePref();
        applyStatic();
      });
    });

    bindTap($('btn-bgm'), function () {
      pref.bgm = !pref.bgm;
      savePref();
      if (window.Sound) window.Sound.setBgmEnabled(pref.bgm);
      applyBgmLabel();
    });

    bindTap($('btn-search'), function () {
      var q = $('search-input').value.trim();
      if (q) go('#q/' + encodeURIComponent(q));
    });
    $('search-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var q = $('search-input').value.trim();
        if (q) go('#q/' + encodeURIComponent(q));
      }
    });
    document.querySelectorAll('[data-back]').forEach(function (b) {
      bindTap(b, function () { goBack(); });
    });
    watchBack();   /* Android の戻るボタン(Play版だけ) */
    bindTap($('footer-guide'), function () { openGuide(false); });
    window.addEventListener('resize', placeGuide);

    /* 🔴 起動時は状態を合わせるだけで鳴らさない(第2引数 false)。実際の再生は最初のタップから。
       Capacitorは自動再生制限を外すため、ここで鳴らすと実機だけ無操作で音が出てしまう。
       ♪ボタンでのONは実際のタップの中なので、その場ですぐ鳴る(上の bindTap 側は引数なし) */
    if (window.Sound) window.Sound.setBgmEnabled(pref.bgm, false);

    /* ⏱ 画面の切り替え(route)は、押した処理(bindTap の fn は location.hash を変えるだけ)が終わったあとの hashchange で動く。
       切り替えの描画が重い(遅い端末)と、同じ指の click がそのあとに届いて 700ms が切れ、切り替わった先の同じ位置の制度カードまで開いていた
       (2026-10-01 にヘッドレスChrome の指のタップで確かめた。click が先に届く回は 👻 で捨てられる)。
       指で押して まだ click が届いていないときだけ、切り替えのあとで時刻を付け直す(bindTap の ⏱ と同じ考え) */
    window.addEventListener('hashchange', function () {
      var g = (ghost && Date.now() <= ghost.until) ? ghost : null;
      try { route(); }
      finally { if (g && ghost === g) g.until = Date.now() + GHOST_MS; }
    });
    ensureL10n(pref.lang, rerenderAll);
    if (!guideDone()) openGuide(true);   /* はじめての つかいかた(読み終えるまで毎回・2026-09-30) */

    /* Service Worker はWeb公開版のオフライン用。
       localhost は「開発プレビュー」と「Capacitorアプリ内(WebViewがlocalhostで配信)」の両方で、
       どちらも実ファイルが手元にあるため登録しない。
       これで開発中の旧版配信と、アプリ更新直後に旧画面が出る事故([[feedback_sw_cache_reopen]])を避ける */
    var host = location.hostname;
    var isLocal = (host === 'localhost' || host === '127.0.0.1' || host === '');
    if ('serviceWorker' in navigator && !isLocal) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
