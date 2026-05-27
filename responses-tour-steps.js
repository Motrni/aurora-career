/**
 * responses-tour-steps.js — 2 шага гайда на странице /responses/
 */
window.RESPONSES_TOUR_STEPS = [
    {
        selector: '#autopilotStatusPanel',
        title: 'Раздел откликов',
        description: 'Аврора автоматически фильтрует вакансии по вашим настройкам и отправляет отклики от вашего имени. Здесь вы видите прогресс и отчёт автопилота.',
        side: 'bottom',
        onBeforeShow: function () {
            if (typeof window.switchMode === 'function') {
                window.switchMode('autopilot');
            }
            var el = document.getElementById('autopilotStatusPanel');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    },
    {
        selector: '#modeTabs',
        title: 'Режимы работы',
        description: 'Автопилот — полная автоматизация. Ручной режим — вы сами выбираете вакансии. Сопровод — генерация сопроводительных писем под конкретную вакансию.',
        side: 'bottom',
        onBeforeShow: function () {
            var el = document.getElementById('modeTabs');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
];
