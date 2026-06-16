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
  var rafId = 0;
  var cur = { scale: 0.42, ty: 60, opacity: 0, play: 0 };
  var target = { scale: 0.42, ty: 60, opacity: 0, play: 0 };
  var animating = false;

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function computeTarget() {
    if (!wrap || !shell || wrap.offsetParent === null) return;

    var viewH = window.innerHeight;
    var rect = wrap.getBoundingClientRect();

    /* progress: 0 — верх обёртки на нижней кромке экрана (видео маленькое),
       1 — верх обёртки поднялся до 30% высоты экрана (видео в финале). */
    var startTop = viewH;
    var endTop = viewH * 0.3;
    var progress = clamp((startTop - rect.top) / (startTop - endTop), 0, 1);

    if (reducedMotion) {
      target.scale = 1; target.ty = 0; target.opacity = 1; target.play = 1;
      return;
    }

    var e = easeInOutCubic(progress);
    target.scale = lerp(0.42, 1, e);
    target.ty = lerp(60, 0, e);
    target.opacity = clamp(progress / 0.35, 0, 1);
    target.play = clamp((progress - 0.25) / 0.45, 0, 1);
  }

  function applyVars() {
    shell.style.setProperty('--hbv-scale', cur.scale.toFixed(4));
    shell.style.setProperty('--hbv-ty', cur.ty.toFixed(2) + 'px');
    shell.style.setProperty('--hbv-opacity', cur.opacity.toFixed(3));
    shell.style.setProperty('--hbv-play-opacity', cur.play.toFixed(3));
  }

  /* Плавное приближение текущих значений к целевым (демпфирование) */
  function animateLoop() {
    var k = reducedMotion ? 1 : 0.18;
    var done = true;
    ['scale', 'ty', 'opacity', 'play'].forEach(function (key) {
      var diff = target[key] - cur[key];
      if (Math.abs(diff) > 0.0005) {
        cur[key] += diff * k;
        done = false;
      } else {
        cur[key] = target[key];
      }
    });
    applyVars();
    if (!done) {
      rafId = requestAnimationFrame(animateLoop);
      animating = true;
    } else {
      animating = false;
    }
  }

  function startAnim() {
    if (!animating) {
      animating = true;
      rafId = requestAnimationFrame(animateLoop);
    }
  }

  function updateProgress() {
    ticking = false;
    if (!wrap || !shell) return;
    computeTarget();
    startAnim();
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
    if (rafId) cancelAnimationFrame(rafId);
    animating = false;
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
