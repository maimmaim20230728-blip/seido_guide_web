/* 困りごと制度ガイド app.js (日英2言語・設定はヘッダー常時表示) */
(function () {
  'use strict';

  var APP_VER = '1.2';
  var ASSET_V = '1.2';   /* 旧Service Workerのcache-firstを確実に外すための版クエリ(index.html/sw.jsと揃える) */
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
      if (window.Sound) window.Sound.tap();
      fn(e);
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

  /* ---------- 画面切替(hashルーティング) ---------- */
  var firstShow = true;
  function show(viewId) {
    ['view-home', 'view-list', 'view-detail'].forEach(function (v) {
      $(v).hidden = (v !== viewId);
    });
    window.scrollTo(0, 0);
    /* 画面が切り替わったことをスクリーンリーダーにも伝えるため、その画面の見出しへ移す
       (初回描画では利用者のフォーカスを奪わない) */
    if (firstShow) { firstShow = false; return; }
    var target = viewId === 'view-list' ? $('list-title')
      : viewId === 'view-detail' ? document.querySelector('#detail-body .d-name')
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
