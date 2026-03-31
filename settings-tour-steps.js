/**
 * settings-tour-steps.js — Tour step configuration for Aurora Career settings.
 * Edit this file to add/modify/reorder guided tour steps.
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
        selector: '#experienceSelect',
        title: 'Опыт работы',
        description: 'Чтобы не сужать выдачу, обычно лучше оставить «Не важно» — так вы не пропустите хорошие вакансии.',
        side: 'bottom'
    },
    {
        selector: '#scheduleContainer',
        title: 'График работы',
        description: 'Выберите подходящие форматы: удалённая работа, офис, гибрид или разъезды. Если ничего не выбрано, поиск идёт по всем форматам.',
        side: 'bottom'
    },
    {
        selector: '#regionContainer',
        title: 'Регионы поиска',
        description: 'Добавьте города и регионы, где хотите искать вакансии. Без указания регионов поиск выполняется максимально широко.',
        side: 'bottom'
    },
    {
        selector: '#industryContainer',
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
        selector: '#tab-btn-response',
        title: 'Вкладки разделов',
        description: 'В «Настройках поиска» вы управляете фильтрами, а в «Настройках откликов» — текстом сопроводительного письма.',
        side: 'bottom',
        onBeforeShow: function () {
            window.switchMainTab('search');
            setTimeout(function () { window.scrollTo({ top: 0, behavior: 'smooth' }); }, 60);
        }
    },
    {
        selector: '#clHeaderInput',
        title: 'Шапка сопроводительного',
        description: 'Текст, который будет вставлен в начало каждого сопроводительного письма. Представьтесь и кратко опишите свою мотивацию.',
        side: 'bottom',
        onBeforeShow: function () {
            window.switchMainTab('response');
        }
    },
    {
        selector: '#clFooterInput',
        title: 'Подпись сопроводительного',
        description: 'Текст подписи в конце письма. Укажите контакты, ссылки на портфолио или Telegram.',
        side: 'top'
    },
    {
        selector: '#helpBtn',
        title: 'Всё готово!',
        description: 'Настройки сконфигурированы. Если понадобится напоминание — нажмите кнопку помощи, и гайд запустится снова.',
        side: 'top',
        onBeforeShow: function () {
            window.switchMainTab('search');
        }
    }
];
