/**
 * Hero B: видео в потоке. По мере появления снизу растёт из маленького
 * состояния до 100% обёртки (≈70% ширины экрана) — финальное состояние.
 * Дальше скроллится как обычный блок. Никакого fixed/sticky.
 */
(function () {
  'use strict';

  var wrap = null;
  var shell = null;
  var ticking = false;
  var bound = false;
  var reducedMotion = false;

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function updateProgress() {
    ticking = false;
    if (!wrap || !shell || wrap.offsetParent === null) return;

    var viewH = window.innerHeight;
    var rect = wrap.getBoundingClientRect();

    /* progress: 0 — верх обёртки на нижней кромке экрана (видео маленькое),
       1 — верх обёртки поднялся до 25% высоты экрана (видео в финале). */
    var startTop = viewH;
    var endTop = viewH * 0.25;
    var progress = clamp((startTop - rect.top) / (startTop - endTop), 0, 1);

    if (reducedMotion) {
      shell.style.setProperty('--hbv-ty', '0px');
      shell.style.setProperty('--hbv-scale', '1');
      shell.style.setProperty('--hbv-opacity', '1');
      shell.style.setProperty('--hbv-play-opacity', '1');
      return;
    }

    var e = easeOutCubic(progress);
    var scale = lerp(0.42, 1, e);
    var ty = lerp(60, 0, e);
    var opacity = clamp(progress * 1.6, 0, 1);
    var playOpacity = clamp((progress - 0.2) / 0.4, 0, 1);

    shell.style.setProperty('--hbv-scale', String(scale));
    shell.style.setProperty('--hbv-ty', ty + 'px');
    shell.style.setProperty('--hbv-opacity', String(opacity));
    shell.style.setProperty('--hbv-play-opacity', String(playOpacity));
  }

  function onScroll() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(updateProgress);
    }
  }

  function bindScroll() {
    if (bound) return;
    bound = true;
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
  }

  function unbindScroll() {
    if (!bound) return;
    bound = false;
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
  }

  function initPreviewVideo() {
    var video = document.getElementById('hero-b-preview-video');
    if (!video || video.dataset.previewInited === '1') return;
    video.dataset.previewInited = '1';

    video.loop = false;
    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute('muted', '');

    video.addEventListener('playing', function () {
      if (shell) shell.classList.add('is-playing');
    });
    video.addEventListener('ended', function () {
      if (!shell) return;
      shell.classList.remove('is-playing');
      shell.classList.add('is-ended');
      try { video.pause(); } catch (e) {}
    });

    if (reducedMotion) return;

    function playOnce() {
      if (video.dataset.previewPlayed === '1') return;
      video.dataset.previewPlayed = '1';
      var p = video.play();
      if (p && p.catch) p.catch(function () {});
    }

    function tryPlayWhenReady() {
      if (video.readyState >= 4) { playOnce(); return; }
      video.preload = 'auto';
      video.addEventListener('canplaythrough', playOnce, { once: true });
      try { video.load(); } catch (e) {}
    }

    if (!shell) return;

    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          tryPlayWhenReady();
          obs.disconnect();
        }
      });
    }, { threshold: 0.3 });

    obs.observe(shell);
  }

  function bindClick() {
    if (!shell || shell.dataset.clickBound === '1') return;
    shell.dataset.clickBound = '1';

    function open() {
      if (typeof openVideoModal === 'function') openVideoModal();
    }

    shell.addEventListener('click', open);
    shell.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  }

  function init() {
    wrap = document.querySelector('#hero-variant-b .hero-b-video-wrap');
    shell = document.getElementById('hero-b-video-trigger');
    if (!wrap || !shell) return;

    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    bindScroll();
    bindClick();
    initPreviewVideo();
    updateProgress();
  }

  function destroy() {
    unbindScroll();
    if (shell) {
      shell.classList.remove('is-playing', 'is-ended');
      shell.style.removeProperty('--hbv-scale');
      shell.style.removeProperty('--hbv-ty');
      shell.style.removeProperty('--hbv-opacity');
      shell.style.removeProperty('--hbv-play-opacity');
      delete shell.dataset.clickBound;
    }
  }

  window.HeroBVideoScroll = { init: init, destroy: destroy };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (document.body.classList.contains('hero-v-b')) init();
    });
  } else if (document.body.classList.contains('hero-v-b')) {
    init();
  }
})();
