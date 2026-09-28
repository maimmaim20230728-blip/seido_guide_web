/* 困りごと制度ガイド app.js (日英2言語・設定はヘッダー常時表示) */
(function () {
  'use strict';

  var APP_VER = '1.8';
  var ASSET_V = '1.8';   /* 旧Service Workerのcache-firstを確実に外すための版クエリ(index.html/sw.jsと揃える) */
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
      if (Math.abs(e.clientX - sx) < 12 && Math.abs(e.clientY - sy) < 12) fire(e);
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
        組織名は出典URLのホストで引く(サブドメインは親の組織にまとめる)。url は組織のトップ(2026-09-28 全件200を実測) */
  var SRC_ORGS = [
    { host: 'mhlw.go.jp', g: 'gov', url: 'https://www.mhlw.go.jp/', ja: '厚生労働省', en: 'Ministry of Health, Labour and Welfare' },
    { host: 'cfa.go.jp', g: 'gov', url: 'https://www.cfa.go.jp/', ja: 'こども家庭庁', en: 'Children and Families Agency' },
    { host: 'mext.go.jp', g: 'gov', url: 'https://www.mext.go.jp/', ja: '文部科学省', en: 'Ministry of Education, Culture, Sports, Science and Technology' },
    { host: 'bousai.go.jp', g: 'gov', url: 'https://www.bousai.go.jp/', ja: '内閣府 防災情報のページ', en: 'Cabinet Office (Disaster Management)' },
    { host: 'gender.go.jp', g: 'gov', url: 'https://www.gender.go.jp/', ja: '内閣府 男女共同参画局', en: 'Cabinet Office (Gender Equality Bureau)' },
    { host: 'nta.go.jp', g: 'gov', url: 'https://www.nta.go.jp/', ja: '国税庁', en: 'National Tax Agency' },
    { host: 'npa.go.jp', g: 'gov', url: 'https://www.npa.go.jp/', ja: '警察庁', en: 'National Police Agency' },
    { host: 'moj.go.jp', g: 'gov', url: 'https://www.moj.go.jp/', ja: '法務省', en: 'Ministry of Justice' },
    { host: 'mlit.go.jp', g: 'gov', url: 'https://www.mlit.go.jp/', ja: '国土交通省', en: 'Ministry of Land, Infrastructure, Transport and Tourism' },
    { host: 'fsa.go.jp', g: 'gov', url: 'https://www.fsa.go.jp/', ja: '金融庁', en: 'Financial Services Agency' },
    { host: 'lfb.mof.go.jp', g: 'gov', url: 'https://lfb.mof.go.jp/', ja: '財務省 財務局', en: 'Local Finance Bureaus (Ministry of Finance)' },
    { host: 'caa.go.jp', g: 'gov', url: 'https://www.caa.go.jp/', ja: '消費者庁', en: 'Consumer Affairs Agency' },
    { host: 'soumu.go.jp', g: 'gov', url: 'https://www.soumu.go.jp/', ja: '総務省', en: 'Ministry of Internal Affairs and Communications' },
    { host: 'laws.e-gov.go.jp', g: 'gov', url: 'https://laws.e-gov.go.jp/', ja: 'e-Gov法令検索(デジタル庁)', en: 'e-Gov Law Search (Digital Agency)' },
    { host: 'nenkin.go.jp', g: 'pub', url: 'https://www.nenkin.go.jp/', ja: '日本年金機構', en: 'Japan Pension Service' },
    { host: 'kyoukaikenpo.or.jp', g: 'pub', url: 'https://www.kyoukaikenpo.or.jp/', ja: '全国健康保険協会(協会けんぽ)', en: 'Japan Health Insurance Association' },
    { host: 'jasso.go.jp', g: 'pub', url: 'https://www.jasso.go.jp/', ja: '日本学生支援機構', en: 'Japan Student Services Organization (JASSO)' },
    { host: 'houterasu.or.jp', g: 'pub', url: 'https://www.houterasu.or.jp/', ja: '日本司法支援センター(法テラス)', en: 'Japan Legal Support Center (Houterasu)' },
    { host: 'jhf.go.jp', g: 'pub', url: 'https://www.jhf.go.jp/', ja: '住宅金融支援機構', en: 'Japan Housing Finance Agency' },
    { host: 'jfc.go.jp', g: 'pub', url: 'https://www.jfc.go.jp/', ja: '日本政策金融公庫', en: 'Japan Finance Corporation' },
    { host: 'kokusen.go.jp', g: 'pub', url: 'https://www.kokusen.go.jp/', ja: '国民生活センター', en: 'National Consumer Affairs Center of Japan' },
    { host: 'wam.go.jp', g: 'pub', url: 'https://www.wam.go.jp/', ja: '福祉医療機構', en: 'Welfare And Medical Service Agency' },
    { host: 'shakyo.or.jp', g: 'pub', url: 'https://www.shakyo.or.jp/', ja: '全国社会福祉協議会', en: 'Japan National Council of Social Welfare' },
    { host: 'johas.go.jp', g: 'pub', url: 'https://www.johas.go.jp/', ja: '労働者健康安全機構', en: 'Japan Organization of Occupational Health and Safety' },
    { host: 'rehab.go.jp', g: 'pub', url: 'https://www.rehab.go.jp/', ja: '国立障害者リハビリテーションセンター', en: 'National Rehabilitation Center for Persons with Disabilities' },
    { host: 'ncnp.go.jp', g: 'pub', url: 'https://www.ncnp.go.jp/', ja: '国立精神・神経医療研究センター', en: 'National Center of Neurology and Psychiatry' },
    { host: 'nanbyou.or.jp', g: 'pub', url: 'https://www.nanbyou.or.jp/', ja: '難病情報センター', en: 'Japan Intractable Diseases Information Center' },
    { host: 'shouman.jp', g: 'pub', url: 'https://www.shouman.jp/', ja: '小児慢性特定疾病情報センター', en: 'Information Center for Specific Pediatric Chronic Diseases' }
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
  /* 制度ページの上に出す1本 = 国の機関・公的機関の出典を優先、無ければ最初の出典 */
  function primarySource(s) {
    var list = s.sources || [];
    for (var i = 0; i < list.length; i++) if (orgOf(hostOf(list[i].url))) return list[i];
    return list[0] || null;
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
    var html = '<h2 id="src-title" class="list-title">' + esc(T('src.title')) + '</h2>';
    html += '<p class="src-intro">' + esc(T('src.intro')) + '</p>';
    html += '<p class="src-indep">' + esc(T('f.disclaimer')) + '</p>';
    SRC_GROUPS.forEach(function (g) {
      var items = Object.keys(groups[g]).map(function (k) { return groups[g][k]; });
      if (!items.length) return;
      items.sort(function (a, b) { return Object.keys(b.ids).length - Object.keys(a.ids).length; });
      html += '<div class="src-group"><h3>' + esc(T('src.' + g)) + '</h3>';
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
      var pText = pref.lang === 'ja' ? ps.title : (po ? po.en : hostOf(ps.url));
      html += '<p class="d-src-top"><span class="d-src-label">' + esc(T('d.srcTop')) + '</span> ' +
        '<a href="' + esc(ps.url) + '" target="_blank" rel="noopener">' + esc(pText) + '</a> ' +
        '<span class="d-src-host">(' + esc(hostOf(ps.url)) + ')</span></p>';
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
      html += '<li>' + esc(src.title) + ' <a href="' + esc(src.url) + '" target="_blank" rel="noopener">' + esc(src.url) + '</a></li>';
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
      bindTap(b, function () { history.length > 1 ? history.back() : go('#home'); });
    });

    /* 🔴 起動時は状態を合わせるだけで鳴らさない(第2引数 false)。実際の再生は最初のタップから。
       Capacitorは自動再生制限を外すため、ここで鳴らすと実機だけ無操作で音が出てしまう。
       ♪ボタンでのONは実際のタップの中なので、その場ですぐ鳴る(上の bindTap 側は引数なし) */
    if (window.Sound) window.Sound.setBgmEnabled(pref.bgm, false);

    window.addEventListener('hashchange', route);
    ensureL10n(pref.lang, rerenderAll);

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
