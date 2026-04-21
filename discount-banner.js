/**
 * discount-banner.js v2.0 — Баннер скидки с двумя режимами:
 *   1) WELCOME (без таймера): discount.expires_at = null. Висит постоянно
 *      пока пользователь не активирует триал (тогда таймер стартует на бэке).
 *   2) TIMER (с обратным отсчётом): discount.expires_at — ISO строка в будущем.
 *      Используется для активного триала, рефки и менторских промо.
 *
 * Использование (после получения данных из /api/auth/me):
 *   if (window.DiscountBanner && data.discount) {
 *       window.DiscountBanner.init(data.discount, { onCabinet: true });
 *   }
 */
(function (global) {
    'use strict';

    var TOTAL_SECONDS = 48 * 3600;
    var CIRCLE_R = 22;
    var CIRCUMFERENCE = 2 * Math.PI * CIRCLE_R;

    var _interval = null;
    var _raf = null;

    function hslForRatio(ratio) {
        var hue = Math.round(ratio * 160);
        var sat = 80;
        var light = 44 + Math.round((1 - ratio) * 8);
        return 'hsl(' + hue + ',' + sat + '%,' + light + '%)';
    }

    function formatTime(totalSec) {
        if (totalSec <= 0) return '00:00:00';
        var h = Math.floor(totalSec / 3600);
        var m = Math.floor((totalSec % 3600) / 60);
        var s = totalSec % 60;
        return (h < 10 ? '0' : '') + h + ':' +
               (m < 10 ? '0' : '') + m + ':' +
               (s < 10 ? '0' : '') + s;
    }

    function getRemainingSeconds(expiresAt) {
        var exp = new Date(expiresAt).getTime();
        var diff = exp - Date.now();
        return Math.max(0, Math.floor(diff / 1000));
    }

    function buildTimerBannerHTML(percent) {
        var discountText = Math.round(percent) + '%';

        return '' +
            '<div id="discountBannerInner" class="relative overflow-hidden rounded-2xl border border-primary/20 p-4 md:p-5" ' +
                 'style="background:linear-gradient(135deg,rgba(101,62,219,0.10) 0%,rgba(90,48,208,0.06) 100%);backdrop-filter:blur(12px);animation:dbFadeIn 0.4s ease;">' +
                '<div class="flex flex-col sm:flex-row items-center gap-4">' +
                    '<div class="flex items-center gap-4 flex-1 min-w-0">' +
                        '<div class="relative shrink-0" style="width:52px;height:52px;">' +
                            '<svg class="block" width="52" height="52" viewBox="0 0 52 52" style="transform:rotate(-90deg);">' +
                                '<circle cx="26" cy="26" r="' + CIRCLE_R + '" fill="transparent" ' +
                                    'stroke="rgba(55,51,62,0.8)" stroke-width="4"></circle>' +
                                '<circle id="dbProgressCircle" cx="26" cy="26" r="' + CIRCLE_R + '" fill="transparent" ' +
                                    'stroke="#10b981" stroke-width="4" stroke-linecap="round" ' +
                                    'stroke-dasharray="' + CIRCUMFERENCE.toFixed(1) + '" ' +
                                    'stroke-dashoffset="0" ' +
                                    'style="transition:stroke 0.5s ease;"></circle>' +
                            '</svg>' +
                            '<div class="absolute inset-0 flex items-center justify-center">' +
                                '<span id="dbRingTime" class="text-[10px] font-bold text-on-surface tabular-nums leading-none"></span>' +
                            '</div>' +
                        '</div>' +
                        '<div class="min-w-0">' +
                            '<p class="text-sm md:text-base font-semibold text-on-surface">' +
                                'Ваша персональная скидка <span class="text-primary">' + discountText + '</span> активна' +
                            '</p>' +
                            '<p class="text-xs md:text-sm text-on-surface-variant mt-0.5">' +
                                'Осталось: <span id="dbCountdown" class="font-medium text-on-surface tabular-nums">--:--:--</span>' +
                            '</p>' +
                        '</div>' +
                    '</div>' +
                    '<button id="dbCtaBtn" class="shrink-0 btn-primary text-white font-medium py-2.5 px-5 rounded-xl text-sm cursor-pointer whitespace-nowrap flex items-center gap-2">' +
                        '<span class="material-symbols-outlined text-base" style="font-size:18px;">local_offer</span>' +
                        'Выбрать тариф со скидкой' +
                    '</button>' +
                '</div>' +
            '</div>';
    }

    function buildWelcomeBannerHTML(percent) {
        var discountText = Math.round(percent) + '%';

        return '' +
            '<div id="discountBannerInner" class="relative overflow-hidden rounded-2xl border border-primary/20 p-4 md:p-5" ' +
                 'style="background:linear-gradient(135deg,rgba(101,62,219,0.10) 0%,rgba(90,48,208,0.06) 100%);backdrop-filter:blur(12px);animation:dbFadeIn 0.4s ease;">' +
                '<div class="flex flex-col sm:flex-row items-center gap-4">' +
                    '<div class="flex items-center gap-4 flex-1 min-w-0">' +
                        '<div class="relative shrink-0 flex items-center justify-center" style="width:52px;height:52px;border-radius:50%;background:rgba(101,62,219,0.18);">' +
                            '<span class="material-symbols-outlined text-primary" style="font-size:28px;">local_offer</span>' +
                        '</div>' +
                        '<div class="min-w-0">' +
                            '<p class="text-sm md:text-base font-semibold text-on-surface">' +
                                'Ваша приветственная скидка <span class="text-primary">' + discountText + '</span> активна' +
                            '</p>' +
                            '<p class="text-xs md:text-sm text-on-surface-variant mt-0.5">' +
                                'Таймер 48 часов запустится после активации пробного периода' +
                            '</p>' +
                        '</div>' +
                    '</div>' +
                    '<button id="dbCtaBtn" class="shrink-0 btn-primary text-white font-medium py-2.5 px-5 rounded-xl text-sm cursor-pointer whitespace-nowrap flex items-center gap-2">' +
                        '<span class="material-symbols-outlined text-base" style="font-size:18px;">local_offer</span>' +
                        'Выбрать тариф со скидкой' +
                    '</button>' +
                '</div>' +
            '</div>';
    }

    function injectStyles() {
        if (document.getElementById('dbStyles')) return;
        var style = document.createElement('style');
        style.id = 'dbStyles';
        style.textContent =
            '@keyframes dbFadeIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}' +
            '@keyframes dbFadeOut{from{opacity:1}to{opacity:0;transform:translateY(-8px)}}';
        document.head.appendChild(style);
    }

    function destroy() {
        if (_interval) { clearInterval(_interval); _interval = null; }
        if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
        var el = document.getElementById('discountBanner');
        if (el) el.innerHTML = '';
    }

    function bindCtaButton(onCabinet) {
        var ctaBtn = document.getElementById('dbCtaBtn');
        if (!ctaBtn) return;
        ctaBtn.addEventListener('click', function () {
            if (onCabinet) {
                var grid = document.getElementById('tariffGrid');
                if (grid) {
                    grid.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            } else {
                window.location.href = '/cabinet/#tariffGrid';
            }
        });
    }

    function init(discountData, opts) {
        if (!discountData || !discountData.percent) return;

        var percent = discountData.percent;
        var onCabinet = (opts && opts.onCabinet) || false;
        var hasTimer = !!discountData.expires_at;

        destroy();
        injectStyles();

        var container = document.getElementById('discountBanner');
        if (!container) return;

        // Welcome-режим: бессрочная скидка без таймера.
        if (!hasTimer) {
            container.innerHTML = buildWelcomeBannerHTML(percent);
            bindCtaButton(onCabinet);
            return;
        }

        // Timer-режим: проверяем что срок ещё не истёк.
        var remaining = getRemainingSeconds(discountData.expires_at);
        if (remaining <= 0) return;

        container.innerHTML = buildTimerBannerHTML(percent);
        bindCtaButton(onCabinet);

        var circle = document.getElementById('dbProgressCircle');
        var ringTime = document.getElementById('dbRingTime');
        var countdown = document.getElementById('dbCountdown');

        function tick() {
            var sec = getRemainingSeconds(discountData.expires_at);
            if (sec <= 0) {
                var inner = document.getElementById('discountBannerInner');
                if (inner) inner.style.animation = 'dbFadeOut 0.3s ease forwards';
                setTimeout(destroy, 350);
                return;
            }

            var ratio = Math.min(sec / TOTAL_SECONDS, 1);
            var offset = CIRCUMFERENCE * (1 - ratio);
            var color = hslForRatio(ratio);

            if (circle) {
                circle.setAttribute('stroke-dashoffset', offset.toFixed(1));
                circle.setAttribute('stroke', color);
            }

            var timeStr = formatTime(sec);
            if (ringTime) {
                var h = Math.floor(sec / 3600);
                ringTime.textContent = h >= 1 ? (h + 'ч') : (Math.floor((sec % 3600) / 60) + 'м');
            }
            if (countdown) countdown.textContent = timeStr;
        }

        tick();
        _interval = setInterval(tick, 1000);
    }

    global.DiscountBanner = {
        init: init,
        destroy: destroy,
    };

})(window);
