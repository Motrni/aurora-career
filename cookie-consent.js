(function () {
  'use strict';

  var COOKIE_NAME = 'aurora_cookie_consent';
  var COOKIE_TTL_DAYS = 365;
  var YM_ID = 106455919;

  function getConsent() {
    var match = document.cookie.match(new RegExp('(?:^|; )' + COOKIE_NAME + '=([^;]*)'));
    return match ? match[1] : null;
  }

  function setConsent(value) {
    var expires = new Date(Date.now() + COOKIE_TTL_DAYS * 864e5).toUTCString();
    document.cookie = COOKIE_NAME + '=' + value + '; path=/; expires=' + expires + '; SameSite=Lax';
  }

  function loadYandexMetrika() {
    if (window._ymLoaded) return;
    window._ymLoaded = true;

    (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
      m[i].l = 1 * new Date();
      for (var j = 0; j < document.scripts.length; j++) {
        if (document.scripts[j].src === r) return;
      }
      k = e.createElement(t); a = e.getElementsByTagName(t)[0];
      k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js?id=' + YM_ID, 'ym');

    ym(YM_ID, 'init', {
      clickmap: true,
      trackLinks: true,
      accurateTrackBounce: true,
      webvisor: true
    });
  }

  function createBanner() {
    var backdrop = document.createElement('div');
    backdrop.id = 'cookie-consent-backdrop';

    var banner = document.createElement('div');
    banner.id = 'cookie-consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Использование файлов cookie');

    banner.innerHTML =
      '<div class="ccb-inner">' +
        '<div class="ccb-icon">' +
          '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10h-1.5a3.5 3.5 0 01-3.5-3.5V8a3 3 0 00-3-3h-.5A3.5 3.5 0 0110 1.5V2z" fill="rgba(204,190,255,0.15)" stroke="#ccbeff" stroke-width="1.5"/>' +
            '<circle cx="8" cy="10" r="1.25" fill="#ccbeff"/>' +
            '<circle cx="12" cy="14" r="1.25" fill="#ccbeff"/>' +
            '<circle cx="15" cy="10" r="1" fill="#ccbeff" opacity="0.6"/>' +
            '<circle cx="9.5" cy="15" r="0.75" fill="#ccbeff" opacity="0.4"/>' +
          '</svg>' +
        '</div>' +
        '<div class="ccb-content">' +
          '<p class="ccb-text">' +
            'Мы используем файлы cookie для аналитики и улучшения сайта. ' +
            'Подробнее в <a href="javascript:void(0)" class="ccb-link" id="ccb-privacy-link">Политике конфиденциальности</a>.' +
          '</p>' +
        '</div>' +
        '<div class="ccb-actions">' +
          '<button id="ccb-accept" class="ccb-btn ccb-btn-accept">Принять</button>' +
          '<button id="ccb-decline" class="ccb-btn ccb-btn-decline">Отклонить</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(backdrop);
    document.body.appendChild(banner);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        banner.classList.add('ccb-visible');
        backdrop.classList.add('ccb-backdrop-visible');
      });
    });

    document.getElementById('ccb-accept').addEventListener('click', function () {
      setConsent('accepted');
      hideBanner(banner, backdrop);
      loadYandexMetrika();
    });

    document.getElementById('ccb-decline').addEventListener('click', function () {
      setConsent('declined');
      hideBanner(banner, backdrop);
    });

    var privacyLink = document.getElementById('ccb-privacy-link');
    privacyLink.addEventListener('click', function (e) {
      e.preventDefault();
      if (typeof openInfoModal === 'function') {
        openInfoModal('privacy');
      } else {
        window.location.href = '/#privacy';
      }
    });
  }

  function hideBanner(banner, backdrop) {
    banner.classList.remove('ccb-visible');
    banner.classList.add('ccb-hiding');
    backdrop.classList.remove('ccb-backdrop-visible');
    setTimeout(function () {
      if (banner.parentNode) banner.parentNode.removeChild(banner);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }, 400);
  }

  function init() {
    var consent = getConsent();

    if (consent === 'accepted') {
      loadYandexMetrika();
      return;
    }

    if (consent === 'declined') {
      return;
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createBanner);
    } else {
      createBanner();
    }
  }

  init();
})();
