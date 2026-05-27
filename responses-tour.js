/**
 * responses-tour.js — гайд по /responses/ (onboarding + help).
 * Использует движок SettingsTour из settings-tour.js.
 */
(function (global) {
    'use strict';

    function startResponsesTour(options) {
        if (!global.SettingsTour || !global.RESPONSES_TOUR_STEPS) {
            console.warn('[ResponsesTour] SettingsTour or steps missing');
            return null;
        }
        var tour = new global.SettingsTour(global.RESPONSES_TOUR_STEPS, options || {});
        tour.start();
        return tour;
    }

    global.startResponsesTour = startResponsesTour;
}(typeof window !== 'undefined' ? window : this));
