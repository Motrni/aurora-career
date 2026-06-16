/**
 * Hero B: scroll-driven появление видео (Stitch-style).
 * Фазы: скрыто → рост снизу → fullscreen → крупный формат справа → docked при скролле ниже.
 */
(function () {
  'use strict';

  var scene = null;
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
    if (!scene || scene.hidden || !shell) return;

    var viewH = window.innerHeight;
    var rect = scene.getBoundingClientRect();
    var scrollable = Math.max(scene.offsetHeight - viewH, 1);
    var scrolled = -rect.top;
    var progress = clamp(scrolled / scrollable, 0, 1);

    if (reducedMotion) {
      shell.style.setProperty('--hbv-scale', '0.52');
      shell.style.setProperty('--hbv-tx', '28vw');
      shell.style.setProperty('--hbv-ty', '0vh');
      shell.style.setProperty('--hbv-opacity', '1');
      shell.style.setProperty('--hbv-play-opacity', '1');
      shell.classList.toggle('is-docked', rect.bottom <= viewH && progress > 0.5);
      return;
    }

    var scale;
    var tx;
    var ty;
    var opacity;
    var playOpacity;

    if (progress < 0.38) {
      var t1 = easeOutCubic(progress / 0.38);
      scale = lerp(0.3, 1, t1);
      ty = lerp(38, 0, t1);
      tx = 0;
      opacity = lerp(0, 1, t1);
      playOpacity = lerp(0, 1, clamp((progress - 0.12) / 0.2, 0, 1));
    } else if (progress < 0.62) {
      scale = 1;
      tx = 0;
      ty = 0;
      opacity = 1;
      playOpacity = 1;
    } else {
      var t2 = easeOutCubic((progress - 0.62) / 0.38);
      scale = lerp(1, 0.52, t2);
      tx = lerp(0, 28, t2);
      ty = 0;
      opacity = 1;
      playOpacity = 1;
    }

    shell.style.setProperty('--hbv-scale', String(scale));
    shell.style.setProperty('--hbv-tx', tx + 'vw');
    shell.style.setProperty('--hbv-ty', ty + 'vh');
    shell.style.setProperty('--hbv-opacity', String(opacity));
    shell.style.setProperty('--hbv-play-opacity', String(playOpacity));

    var docked = progress >= 0.85 && rect.bottom <= viewH;
    shell.classList.toggle('is-docked', docked);
    scene.classList.toggle('is-docked-active', docked);
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
    }, { threshold: 0.2 });

    obs.observe(shell);
  }

  function bindClick() {
    if (!shell || shell.dataset.clickBound === '1') return;
    shell.dataset.clickBound = '1';

    function open(e) {
      if (e.target.closest('.hero-b-play-intro')) {
        e.stopPropagation();
      }
      if (typeof openVideoModal === 'function') openVideoModal();
    }

    shell.addEventListener('click', open);
    shell.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(e);
      }
    });
  }

  function init() {
    scene = document.getElementById('hero-b-video-scene');
    shell = document.getElementById('hero-b-video-trigger');
    if (!scene || !shell) return;

    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    bindScroll();
    bindClick();
    initPreviewVideo();
    updateProgress();
  }

  function destroy() {
    unbindScroll();
    if (shell) {
      shell.classList.remove('is-docked', 'is-playing', 'is-ended');
      shell.style.removeProperty('--hbv-scale');
      shell.style.removeProperty('--hbv-tx');
      shell.style.removeProperty('--hbv-ty');
      shell.style.removeProperty('--hbv-opacity');
      shell.style.removeProperty('--hbv-play-opacity');
      delete shell.dataset.clickBound;
    }
    if (scene) scene.classList.remove('is-docked-active');
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
