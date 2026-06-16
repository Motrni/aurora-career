/**
 * Hero B: scroll-driven видео без пустого runway.
 * Прогресс считается от конца панели; stats идёт сразу под hero.
 */
(function () {
  'use strict';

  var hero = null;
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

  function getMetrics() {
    var viewH = window.innerHeight;
    var heroIn = hero.querySelector('.hero-in');
    var spacer = hero.querySelector('.hero-b-spacer');
    var heroTop = hero.getBoundingClientRect().top + window.scrollY;
    var contentEnd = heroTop + heroIn.offsetTop + heroIn.offsetHeight;
    var spacerH = spacer ? spacer.offsetHeight : 0;
    /* Старт: первые ~12% скролла после панели — видео уже растёт */
    var animStart = Math.max(40, contentEnd + spacerH - viewH * 0.88);
    var animRange = viewH * 0.38;
    return { viewH: viewH, animStart: animStart, animRange: animRange };
  }

  function updateProgress() {
    ticking = false;
    if (!hero || hero.hidden || !shell) return;

    var m = getMetrics();
    var progress = clamp((window.scrollY - m.animStart) / m.animRange, 0, 1);
    var isMaxed = progress >= 1;

    document.body.classList.toggle('hero-b-video-maxed', isMaxed);

    if (reducedMotion) {
      shell.classList.toggle('is-maxed', isMaxed || progress > 0.2);
      shell.style.setProperty('--hbv-opacity', progress > 0.05 ? '1' : '0');
      shell.style.setProperty('--hbv-play-opacity', progress > 0.15 ? '1' : '0');
      return;
    }

    if (isMaxed) {
      shell.classList.add('is-maxed', 'is-visible');
      shell.style.setProperty('--hbv-scale', '1');
      shell.style.setProperty('--hbv-tx', '0');
      shell.style.setProperty('--hbv-ty', '0');
      shell.style.setProperty('--hbv-opacity', '1');
      shell.style.setProperty('--hbv-play-opacity', '1');
      return;
    }

    shell.classList.remove('is-maxed');

    var scale;
    var tx;
    var ty;
    var opacity;
    var playOpacity;

    if (progress <= 0) {
      scale = 0.28;
      ty = 38;
      tx = 0;
      opacity = 0;
      playOpacity = 0;
      shell.classList.remove('is-visible');
    } else if (progress < 0.55) {
      var t1 = easeOutCubic(progress / 0.55);
      scale = lerp(0.28, 1, t1);
      ty = lerp(38, 0, t1);
      tx = 0;
      opacity = lerp(0, 1, Math.min(t1 * 1.4, 1));
      playOpacity = lerp(0, 1, clamp((progress - 0.08) / 0.25, 0, 1));
    } else {
      var t2 = easeOutCubic((progress - 0.55) / 0.45);
      scale = lerp(1, 0.52, t2);
      tx = lerp(0, 30, t2);
      ty = 0;
      opacity = 1;
      playOpacity = 1;
    }

    shell.style.setProperty('--hbv-scale', String(scale));
    shell.style.setProperty('--hbv-tx', tx + 'vw');
    shell.style.setProperty('--hbv-ty', ty + 'vh');
    shell.style.setProperty('--hbv-opacity', String(opacity));
    shell.style.setProperty('--hbv-play-opacity', String(playOpacity));
    shell.classList.toggle('is-visible', opacity > 0.05);
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
    document.body.classList.remove('hero-b-video-maxed');
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
    }, { threshold: 0.15 });

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
    hero = document.getElementById('hero-variant-b');
    shell = document.getElementById('hero-b-video-trigger');
    if (!hero || !shell) return;

    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    bindScroll();
    bindClick();
    initPreviewVideo();
    updateProgress();
  }

  function destroy() {
    unbindScroll();
    if (shell) {
      shell.classList.remove('is-maxed', 'is-visible', 'is-playing', 'is-ended');
      shell.style.removeProperty('--hbv-scale');
      shell.style.removeProperty('--hbv-tx');
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
