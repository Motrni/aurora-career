/**
 * settings-tour-steps.js — Tour step configuration for Aurora Career settings.
 * Edit this file to add/modify/reorder guided tour steps.
 * Selectors point to full container sections for proper spotlight coverage.
 */

window.SETTINGS_TOUR_STEPS = [
    {
        selector: '#vacancyCounterPanel',
        title: 'Найдено вакансий',
        description: 'Здесь отображается количество вакансий по вашим текущим настройкам. После изменения фильтров число обновляется автоматически.',
        side: 'bottom',
        onBeforeShow: function () {
            window.switchMainTab('search');
            setTimeout(function () { window.scrollTo({ top: 0, behavior: 'smooth' }); }, 60);
        }
    },
    {
        selector: '#salarySection',
        title: 'Желаемая зарплата',
        description: 'Укажите желаемый доход или включите «Не указана». Вакансии с подходящим уровнем дохода будут приоритетнее.',
        side: 'bottom'
    },
    {
        selector: '#experienceSection',
        title: 'Опыт работы',
        description: 'Чтобы не сужать выдачу, обычно лучше оставить «Не важно» — так вы не пропустите хорошие вакансии.',
        side: 'bottom'
    },
    {
        selector: '#scheduleSection',
        title: 'График работы',
        description: 'Выберите подходящие форматы: удалённая работа, офис, гибрид или разъезды. Если ничего не выбрано, поиск идёт по всем форматам.',
        side: 'bottom'
    },
    {
        selector: '#regionSection',
        title: 'Регионы поиска',
        description: 'Добавьте города и регионы, где хотите искать вакансии. Без указания регионов поиск выполняется максимально широко.',
        side: 'bottom'
    },
    {
        selector: '#industrySection',
        title: 'Отрасли компаний',
        description: 'Укажите интересующие отрасли, чтобы исключить вакансии из нерелевантных направлений.',
        side: 'bottom'
    },
    {
        selector: '#queryModeSection',
        title: 'Режим поискового запроса',
        description: 'Простой режим — поиск по ключевым словам. Boolean — расширенный запрос для точной выдачи. Если сомневаетесь, оставьте текущий.',
        side: 'bottom'
    },
    {
        selector: '#tabSwitcher',
        title: 'Вкладки разделов',
        description: 'В «Настройках поиска» вы управляете фильтрами, а в «Настройках откликов» — текстом сопроводительного письма.',
        side: 'bottom',
        onBeforeShow: function () {
            window.switchMainTab('search');
            setTimeout(function () { window.scrollTo({ top: 0, behavior: 'smooth' }); }, 60);
        }
    },
    {
        selector: '#aiSwitchCard',
        title: 'AI-режим сопроводительного',
        description: 'Когда включено — нейросеть сама создаёт идеальное приветствие и подпись для каждого отклика. Если хотите свой текст — выключите переключатель.',
        side: 'bottom',
        onBeforeShow: function () {
            window.switchMainTab('response');
        }
    },
    {
        selector: '#clCustomFields',
        title: 'Шапка и подпись письма',
        description: 'Если вы отключили AI-режим, здесь можно указать своё приветствие (начало письма) и подпись (конец письма). Они будут добавляться к каждому отклику автоматически.',
        side: 'bottom',
        onBeforeShow: function () {
            var checkbox = document.getElementById('clUseDefaultCheckbox');
            if (checkbox && checkbox.checked) {
                checkbox.checked = false;
                checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            }
            var fields = document.getElementById('clCustomFields');
            if (fields) fields.style.display = '';
        }
    },
    {
        selector: '#clPreviewBox',
        title: 'Предпросмотр отклика',
        description: 'Здесь видно, как ваш отклик будет выглядеть для рекрутера. Шапка и подпись подставляются автоматически — проверьте, всё ли выглядит так, как нужно.',
        side: 'top',
        onBeforeShow: function () {
            window.switchMainTab('response');
        }
    },
    {
        selector: '#helpBtn',
        title: 'Кнопка помощи',
        description: 'Если понадобится напоминание по настройкам — нажмите эту кнопку, и гайд запустится снова.',
        side: 'top',
        onBeforeShow: function () {
            window.switchMainTab('search');
        }
    },
    {
        selector: '#saveBtn',
        title: 'Сохраните настройки',
        description: 'После изменения настроек сохраните результаты — и вы сможете перейти в другие разделы сайта.',
        side: 'top',
        onBeforeShow: function () {
            window.switchMainTab('search');
            var footer = document.querySelector('#saveBtn');
            if (footer) footer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
];
