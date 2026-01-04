document.addEventListener('DOMContentLoaded', function() {
    
    // === ЛОГИКА БУРГЕР-МЕНЮ ===
    const burger = document.querySelector('.burger-menu');
    const navMenu = document.querySelector('.nav-menu');
    const navLinks = document.querySelectorAll('.nav-link');

    // Клик по бургеру
    burger.addEventListener('click', () => {
        burger.classList.toggle('active');
        navMenu.classList.toggle('active');
        
        if (navMenu.classList.contains('active')) {
            lockScroll(); // Блокируем скролл с компенсацией
        } else {
            unlockScroll(); // Разблокируем
        }
    });

    // Закрываем меню при клике на любую ссылку
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            burger.classList.remove('active');
            navMenu.classList.remove('active');
            unlockScroll();
        });
    });
    
    // === ЛОГИКА POP-UP ===
    const popupOverlay = document.getElementById('popup-overlay');
    const closeBtn = document.querySelector('.close-popup');
    const openButtons = document.querySelectorAll('.open-popup');

    function openPopup() {
        popupOverlay.classList.remove('hidden'); // Сначала показываем блок
        lockScroll(); // Блокируем скролл с компенсацией
        
        // Небольшая задержка, чтобы браузер успел отрисовать display: flex перед opacity
        setTimeout(() => {
            popupOverlay.classList.add('active');
        }, 10);
    }

    function closePopup() {
        popupOverlay.classList.remove('active');
        
        // Ждем окончания анимации (300мс), потом прячем и возвращаем скролл
        setTimeout(() => {
            popupOverlay.classList.add('hidden');
            unlockScroll();
        }, 300);
    }

    // === ФУНКЦИИ БЛОКИРОВКИ СКРОЛЛА (БЕЗ ДЕРГАНЬЯ) ===
    function lockScroll() {
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
        document.body.style.paddingRight = `${scrollbarWidth}px`;
        // Хедер фиксированный, его тоже нужно отодвинуть
        document.querySelector('.header').style.paddingRight = `${scrollbarWidth}px`; 
        document.body.style.overflow = 'hidden';
    }

    function unlockScroll() {
        document.body.style.paddingRight = '';
        document.querySelector('.header').style.paddingRight = '';
        document.body.style.overflow = '';
    }

    // === СЛУШАТЕЛИ СОБЫТИЙ ===
    openButtons.forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            openPopup();
        });
    });

    closeBtn.addEventListener('click', closePopup);

    popupOverlay.addEventListener('click', function(e) {
        if (e.target === popupOverlay) {
            closePopup();
        }
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && popupOverlay.classList.contains('active')) {
            closePopup();
        }
    });
});