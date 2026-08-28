/* 困りごと制度ガイド app.js (12言語対応) */
(function () {
  'use strict';

  var APP_VER = '1.0';
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
    sc.src = 'js/data_' + lang + '.js';
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

  /* タップ方式(長押しでも発火・スクロールでは発火しない) */
  function bindTap(el, fn) {
    var sx = 0, sy = 0, active = false;
    el.addEventListener('pointerdown', function (e) {
      active = true; sx = e.clientX; sy = e.clientY;
    });
    el.addEventListener('pointerup', function (e) {
      if (!active) return;
      active = false;
      if (Math.abs(e.clientX - sx) < 12 && Math.abs(e.clientY - sy) < 12) fn(e);
    });
    el.addEventListener('pointercancel', function () { active = false; });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); }
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
  function show(viewId) {
    ['view-home', 'view-list', 'view-detail'].forEach(function (v) {
      $(v).hidden = (v !== viewId);
    });
    window.scrollTo(0, 0);
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

  /* ---------- 表示言語・文字サイズの適用 ---------- */
  function applyStatic() {
    document.documentElement.lang = pref.lang;
    document.body.setAttribute('data-fs', String(pref.fs));

    document.title = T('app.name');
    $('app-title').textContent = T('app.name');
    $('app-sub').textContent = T('app.tagline');
    $('set-label').textContent = T('set.label');
    $('btn-exit').textContent = T('header.close');
    $('btn-exit').setAttribute('aria-label', T('header.closeAria'));
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
    $('set-title').textContent = T('set.title');
    $('set-fs-label').textContent = T('set.fs');
    $('set-fs-0').textContent = T('set.fsNormal');
    $('set-fs-1').textContent = T('set.fsLarge');
    $('set-fs-2').textContent = T('set.fsXL');
    $('set-close').textContent = T('set.close');
    document.querySelectorAll('.set-fs-btn').forEach(function (b) {
      b.classList.toggle('on', Number(b.getAttribute('data-fs')) === pref.fs);
    });
    $('set-lang').value = pref.lang;
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

  /* ---------- せってい ---------- */
  function openSet() { $('set-overlay').hidden = false; }
  function closeSet() { $('set-overlay').hidden = true; }

  /* ---------- 初期化 ---------- */
  function init() {
    bindTap($('btn-exit'), function () { location.replace(EXIT_URL); });
    bindTap($('btn-set'), openSet);
    bindTap($('set-close'), closeSet);
    $('set-overlay').addEventListener('pointerup', function (e) {
      if (e.target === $('set-overlay')) closeSet();
    });
    $('set-lang').addEventListener('change', function () { setLang(this.value); });
    document.querySelectorAll('.set-fs-btn').forEach(function (b) {
      bindTap(b, function () {
        pref.fs = Number(b.getAttribute('data-fs')) || 0;
        savePref();
        applyStatic();
      });
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

    window.addEventListener('hashchange', route);
    ensureL10n(pref.lang, rerenderAll);

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
