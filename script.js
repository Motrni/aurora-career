document.addEventListener('DOMContentLoaded', function() {
    // === ЛОГИКА БУРГЕР-МЕНЮ ===
    const burger = document.querySelector('.burger-menu');
    const navMenu = document.querySelector('.nav-menu');
    const navLinks = document.querySelectorAll('.nav-link');

    // Клик по бургеру
    burger.addEventListener('click', () => {
        burger.classList.toggle('active'); // Превращаем полоски в крестик
        navMenu.classList.toggle('active'); // Выезжает меню
        
        // Блокируем скролл сайта, если меню открыто
        if (navMenu.classList.contains('active')) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
    });

    // Закрываем меню при клике на любую ссылку (Якорь)
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            burger.classList.remove('active');
            navMenu.classList.remove('active');
            document.body.style.overflow = '';
        });
    });
    
    // 1. Находим элементы на странице
    const popupOverlay = document.getElementById('popup-overlay');
    const closeBtn = document.querySelector('.close-popup');
    
    // Находим ВСЕ кнопки, у которых есть класс 'open-popup'
    // (и в шапке, и в первом экране, и в футере)
    const openButtons = document.querySelectorAll('.open-popup');

    // 2. Функция: Открыть окно
    function openPopup() {
        popupOverlay.classList.add('active'); // Добавляем класс, который меняет opacity на 1
        document.body.style.overflow = 'hidden'; // Запрещаем скролл основного сайта, пока открыто окно
    }

    // 3. Функция: Закрыть окно
    function closePopup() {
        popupOverlay.classList.remove('active');
        popupOverlay.classList.add('hidden'); // На всякий случай возвращаем hidden
        // Небольшой хак: убираем класс hidden через мгновение, чтобы transition сработал, 
        // но в CSS мы управляем через .active, так что главное - убрать active.
        document.body.style.overflow = ''; // Возвращаем скролл
    }

    // 4. Вешаем "слушателей" (события)

    // Проходимся по каждой кнопке-открывашке
    openButtons.forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.preventDefault(); // Чтобы ссылка не подпрыгивала вверх
            popupOverlay.classList.remove('hidden'); // Убираем жесткое скрытие
            setTimeout(() => {
                openPopup(); // Запускаем анимацию
            }, 10);
        });
    });

    // Клик по крестику
    closeBtn.addEventListener('click', closePopup);

    // Клик по темному фону (чтобы закрыть, кликнув мимо окна)
    popupOverlay.addEventListener('click', function(e) {
        if (e.target === popupOverlay) {
            closePopup();
        }
    });

    // Закрытие по кнопке ESC (для удобства)
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && popupOverlay.classList.contains('active')) {
            closePopup();
        }
    });

});