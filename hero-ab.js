/**
 * Переключение hero A/B на dev-стенде.
 * A — видео-hero, B — интерактивный hero.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'heroVariant';

  function isDevHost() {
    var h = window.location.hostname;
    return h.indexOf('aurora-develop') !== -1 || h.indexOf('twc1.net') !== -1;
  }

  function readVariant() {
    var q = new URLSearchParams(window.location.search).get('hero');
    if (q === 'A' || q === 'B') return q;
    if (isDevHost()) {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'A' || saved === 'B') return saved;
    }
    return 'A';
  }

  function track(eventName, variant) {
    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, { hero_variant: variant });
    }
    if (typeof window.ym === 'function') {
      window.ym(0, 'reachGoal', eventName + '_' + variant);
    }
  }

  function trackHeroView(variant) {
    track('hero_view', variant);
  }

  function trackCta() {
    track('cta_click', currentVariant);
  }

  var currentVariant = 'A';
  var hdrScrollBound = false;

  function bindHdrScroll() {
    if (hdrScrollBound) return;
    hdrScrollBound = true;
    var hdr = document.getElementById('site-header');
    if (!hdr) return;
    function onScroll() {
      if (!document.body.classList.contains('hero-v-b')) return;
      hdr.classList.toggle('scrolled', window.scrollY > 120);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function updateAbButtons() {
    var wrap = document.getElementById('hero-ab-switch');
    if (!wrap) return;
    wrap.querySelectorAll('.hero-ab-btn').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.v === currentVariant);
    });
  }

  function applyVariant(variant, opts) {
    opts = opts || {};
    currentVariant = variant;
    if (isDevHost()) {
      try { localStorage.setItem(STORAGE_KEY, variant); } catch (e) {}
    }

    document.body.classList.toggle('hero-v-a', variant === 'A');
    document.body.classList.toggle('hero-v-b', variant === 'B');

    var heroA = document.getElementById('hero');
    var heroB = document.getElementById('hero-variant-b');
    if (heroA) heroA.hidden = variant !== 'A';
    if (heroB) heroB.hidden = variant !== 'B';

    var hdr = document.getElementById('site-header');
    if (hdr) {
      hdr.classList.toggle('hdr', variant === 'B');
      if (variant !== 'B') hdr.classList.remove('scrolled');
    }

    if (variant === 'B') {
      if (window.HeroWave) window.HeroWave.init();
      if (window.HeroInteractive) window.HeroInteractive.init();
      bindHdrScroll();
    } else {
      if (window.HeroWave) window.HeroWave.destroy();
      if (typeof initHeroPreviewVideo === 'function') initHeroPreviewVideo();
    }

    updateAbButtons();

    if (!opts.silent) trackHeroView(variant);
  }

  function init() {
    var abSwitch = document.getElementById('hero-ab-switch');
    if (abSwitch) {
      abSwitch.hidden = !isDevHost();
      abSwitch.querySelectorAll('.hero-ab-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var v = btn.dataset.v;
          if (v === currentVariant) return;
          applyVariant(v);
        });
      });
    }

    document.querySelectorAll('[data-cta]').forEach(function (el) {
      el.addEventListener('click', trackCta);
    });

    var q = new URLSearchParams(window.location.search).get('hero');
    if ((q === 'A' || q === 'B') && isDevHost()) {
      try { localStorage.setItem(STORAGE_KEY, q); } catch (e) {}
    }

    applyVariant(readVariant(), { silent: false });
  }

  window.HeroAB = {
    init: init,
    apply: applyVariant,
    trackCta: trackCta,
    getVariant: function () { return currentVariant; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
