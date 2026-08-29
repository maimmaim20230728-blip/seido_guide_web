'use strict';
/* 音まわり: 生成BGM(1パターン「calm」のみ)
   ・BGMはWeb Audioでその場生成(音源ファイル無し=軽量・完全オフライン)
   ・ねらい: 制度をゆっくり読むための、音量低め・穏やか・明るすぎない昼のパッド(Dメジャー系)
   ・タップ音は鳴らさない。Sound.tap()は無音のまま、最初のタップでBGMを始めるトリガーだけを担う
   🔴 起動しただけでは鳴らさない(app.jsは setBgmEnabled(pref.bgm, false) で状態だけ同期する)。
      Capacitorは setMediaPlaybackRequiresUserGesture(false) で自動再生制限を外すため、
      ブラウザの制限に頼ると実機だけ無操作で鳴り出す。開始条件はこのファイル側で担保する。
   🔴 画面を離れている間(タブ非表示・ホームに戻る・画面OFF)は suspend して鳴らさない */
var Sound = (function () {
  var ctx = null;
  var bgmEnabled = true;      /* app.js の pref.bgm と同期 */
  var playing = false;
  var master = null, filter = null;
  var timer = 0, nextBar = 0, chordIdx = 0;

  /* calm パターン(ゆっくり・低音量・穏やか。Dmaj7 → Bm7 → Gmaj7 → A7sus4 の循環) */
  var CALM = {
    bar: 7.2, vol: 0.024, lp: 600, type: 'sine',
    chords: [
      [146.83, 185.00, 220.00, 277.18],
      [123.47, 146.83, 185.00, 220.00],
      [98.00, 123.47, 146.83, 185.00],
      [110.00, 146.83, 164.81, 220.00]
    ],
    /* まばらな単音(Dメジャーペンタトニック) */
    scale: [293.66, 329.63, 369.99, 440.00, 493.88]
  };

  /* AudioContextを用意する。suspendedならresume(Promise)し、解けたら開始判定をやり直す。
     🔴 resume()は非同期。直後にstateを同期で読んでも'suspended'のままなので、必ずthenで拾う */
  function ensure() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; }
    }
    if (ctx && ctx.state === 'suspended') {
      try {
        ctx.resume().then(function () { maybeStartBgm(); }).catch(function () {});
      } catch (e) {}
    }
  }

  function scheduleBar(t) {
    var p = CALM;
    var chord = p.chords[chordIdx % p.chords.length];
    chordIdx++;
    /* パッド(和音・ゆっくり膨らんでゆっくり消える) */
    chord.forEach(function (f) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = p.type; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(p.vol, t + p.bar * 0.4);
      g.gain.linearRampToValueAtTime(0.0001, t + p.bar * 1.35);
      o.connect(g); g.connect(filter);
      o.start(t); o.stop(t + p.bar * 1.4);
    });
    /* まばらな単音(1小節に0〜1音) */
    if (Math.random() < 0.5) {
      var nt = t + p.bar * (0.2 + Math.random() * 0.6);
      var f2 = p.scale[Math.floor(Math.random() * p.scale.length)];
      var o2 = ctx.createOscillator(), g2 = ctx.createGain();
      o2.type = 'sine'; o2.frequency.value = f2;
      g2.gain.setValueAtTime(0.0001, nt);
      g2.gain.linearRampToValueAtTime(p.vol * 0.5, nt + 0.08);
      g2.gain.exponentialRampToValueAtTime(0.0001, nt + 2.6);
      o2.connect(g2); g2.connect(filter);
      o2.start(nt); o2.stop(nt + 2.7);
    }
  }

  function startBgm() {
    ensure();
    if (!ctx || playing) return;
    if (ctx.state === 'suspended') return;   /* まだ許可されていない→resumeのthenで再挑戦する */
    master = ctx.createGain(); master.gain.value = 1;
    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = CALM.lp;
    filter.connect(master); master.connect(ctx.destination);
    playing = true; chordIdx = 0;
    nextBar = ctx.currentTime + 0.1;
    scheduleBar(nextBar); nextBar += CALM.bar;
    timer = setInterval(function () {
      if (!playing || !ctx) return;
      if (ctx.currentTime > nextBar - 1.2) {
        scheduleBar(nextBar);
        nextBar += CALM.bar;
      }
    }, 400);
  }

  function stopBgm() {
    if (!playing) return;
    playing = false;
    clearInterval(timer);
    if (master && ctx) {
      try {
        master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);   /* ゆっくりフェードアウト */
        var m = master;
        setTimeout(function () { try { m.disconnect(); } catch (e) {} }, 1600);
      } catch (e) {}
    }
    master = null; filter = null;
  }

  function maybeStartBgm() { if (bgmEnabled && !playing) startBgm(); }

  /* tap(): 音は鳴らさない。最初のタップ=音を出してよくなる瞬間にBGMを始めるトリガー。
     「おと なし」の人にはAudioContextすら作らない */
  function tap() {
    if (!bgmEnabled) return;
    ensure();
    maybeStartBgm();
  }

  /* 画面を離れている間は鳴らさない(ホームに戻る・画面OFF・タブ切替・「× とじる」での離脱)。
     suspend中はctx.currentTimeも止まるので、戻ったときは予約の続きからそのまま鳴る */
  function suspendNow() {
    if (!ctx) return;
    try { ctx.suspend(); } catch (e) {}
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      if (!ctx) return;
      if (document.hidden) { suspendNow(); return; }
      if (playing && bgmEnabled) { try { ctx.resume().catch(function () {}); } catch (e) {} }
    });
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', suspendNow);
  }

  return {
    tap: tap,
    /* startNow=false なら状態を合わせるだけで鳴らさない(起動時の同期用) */
    setBgmEnabled: function (v, startNow) {
      bgmEnabled = !!v;
      if (!bgmEnabled) { stopBgm(); return; }
      if (startNow !== false) { ensure(); maybeStartBgm(); }
    },
    get bgmEnabled() { return bgmEnabled; },
    get bgmPlaying() { return playing; }
  };
})();
window.Sound = Sound;
