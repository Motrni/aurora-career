
// settings.js

// КОНФИГУРАЦИЯ
const API_BASE_URL = "https://api.aurora-career.ru";

// Храним состояние
let initialSettings = {};
let allIndustries = []; // Кэш индустрий
let currentSelectedIds = new Set(); // Текущие выбранные ID

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Параметры URL
    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('user_id');
    const sign = urlParams.get('sign');

    if (!userId || !sign) {
        showError("Ошибка доступа. Ссылка не содержит необходимых параметров.");
        return;
    }

    // 2. Логика зарплаты
    const salaryInput = document.getElementById("salaryInput");
    const noSalaryCheckbox = document.getElementById("noSalaryCheckbox");

    noSalaryCheckbox.addEventListener("change", (e) => {
        if (e.target.checked) {
            salaryInput.value = "";
            salaryInput.disabled = true;
            salaryInput.placeholder = "Не указана";
            salaryInput.style.borderColor = "#333";
        } else {
            salaryInput.disabled = false;
            salaryInput.placeholder = "Например: 100000";
            salaryInput.focus();
        }
    });

    // 3. Поиск индустрии
    const searchInput = document.getElementById("industrySearch");
    searchInput.addEventListener("input", (e) => {
        const text = e.target.value.trim().toLowerCase();
        renderIndustryTree(text);
    });

    // 4. Загрузка данных
    try {
        await loadIndustriesDict();
        await loadSettings(userId, sign);
    } catch (e) {
        showError("Не удалось загрузить настройки. " + e.message);
    }

    // 5. Сохранение
    document.getElementById("saveBtn").addEventListener("click", async () => {
        try {
            await saveSettings(userId, sign);
        } catch (e) {
            showError("Ошибка при сохранении. " + e.message);
        }
    });
});

async function loadIndustriesDict() {
    try {
        const resp = await fetch('industries.json');
        if (!resp.ok) throw new Error("Industries failed");
        allIndustries = await resp.json();
    } catch (e) {
        console.error(e);
        document.getElementById("loadingIndustries").innerText = "Ошибка загрузки справочника индустрий.";
    }
}

async function loadSettings(userId, sign) {
    const response = await fetch(`${API_BASE_URL}/api/settings/get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: parseInt(userId), sign: sign })
    });

    const data = await response.json();
    if (data.status !== "ok") {
        throw new Error(data.error || "Неизвестная ошибка");
    }

    const settings = data.settings;

    // --- Зарплата ---
    const salaryInput = document.getElementById("salaryInput");
    const noSalaryCheckbox = document.getElementById("noSalaryCheckbox");

    if (!settings.salary || settings.salary === 0) {
        noSalaryCheckbox.checked = true;
        salaryInput.value = "";
        salaryInput.disabled = true;
        salaryInput.placeholder = "Не указана";
    } else {
        noSalaryCheckbox.checked = false;
        salaryInput.value = settings.salary;
        salaryInput.disabled = false;
    }

    // --- Опыт ---
    if (settings.experience) document.getElementById("experienceSelect").value = settings.experience;

    // --- Регион ---
    if (settings.search_area) {
        document.getElementById("cityStatus").innerText = `Текущий регион ID: ${settings.search_area}`;
    }

    // --- Индустрии ---
    currentSelectedIds = new Set(settings.industry || []);
    renderIndustryTree();

    // Сохраняем начальное состояние
    initialSettings = {
        salary: settings.salary || null,
        experience: settings.experience || "noExperience",
        industry: settings.industry || []
    };
    if (initialSettings.salary === 0) initialSettings.salary = null;
}

// Рендер дерева с фильтрацией
function renderIndustryTree(filterText = "") {
    const container = document.getElementById("industryTree");
    container.innerHTML = ""; // Очищаем

    // Если данных нет
    if (!allIndustries || allIndustries.length === 0) {
        container.innerHTML = '<div style="color: #666; text-align: center; padding: 20px;">Нет данных</div>';
        return;
    }

    // Создаем SVG иконки заранее
    const chevronSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

    allIndustries.forEach(category => {
        const catNameLower = category.name.toLowerCase();
        const children = category.industries || [];

        // Фильтрация: находим детей, которые подходят
        let matchingChildren = children;
        let isCatMatch = false;

        if (filterText) {
            if (catNameLower.includes(filterText)) {
                // Если категория подходит - показываем всех детей
                isCatMatch = true;
                matchingChildren = children;
            } else {
                // Иначе ищем только подходящих детей
                matchingChildren = children.filter(c => c.name.toLowerCase().includes(filterText));
            }

            // Если ни категория, ни дети не подходят - пропускаем
            if (!isCatMatch && matchingChildren.length === 0) return;
        }

        // --- Создание DOM ---
        const catDiv = document.createElement("div");
        catDiv.className = "ind-category";

        const headerDiv = document.createElement("div");
        headerDiv.className = "ind-header";

        // 1. Иконка (House/Chevron)
        const toggleIcon = document.createElement("div");
        toggleIcon.className = "toggle-icon";
        toggleIcon.innerHTML = chevronSvg;

        // 2. Чекбокс родителя
        const catCheckbox = document.createElement("input");
        catCheckbox.type = "checkbox";
        catCheckbox.className = "custom-checkbox";
        catCheckbox.value = category.id;
        catCheckbox.dataset.type = "parent";

        // 3. Текст родителя
        const catLabel = document.createElement("span");
        catLabel.className = "ind-label";
        catLabel.innerText = category.name;
        // Подсветка при поиске
        if (filterText && isCatMatch) catLabel.style.color = "#a962ff";

        // 4. Счетчик (опционально)
        // const countSpan = document.createElement("span");
        // countSpan.className = "ind-count";
        // countSpan.innerText = children.length;

        headerDiv.appendChild(toggleIcon);
        headerDiv.appendChild(catCheckbox);
        headerDiv.appendChild(catLabel);
        // headerDiv.appendChild(countSpan);
        catDiv.appendChild(headerDiv);

        // --- Контейнер детей ---
        const childrenContainer = document.createElement("div");
        childrenContainer.className = "ind-children";

        // Если есть фильтр - раскрываем сразу
        if (filterText) {
            childrenContainer.classList.add("open");
            toggleIcon.classList.add("expanded");
        }

        // Рендерим детей
        matchingChildren.forEach(sub => {
            const subDiv = document.createElement("div");
            subDiv.className = "ind-sub";

            const subCheckbox = document.createElement("input");
            subCheckbox.type = "checkbox";
            subCheckbox.className = "custom-checkbox";
            subCheckbox.value = sub.id;
            subCheckbox.dataset.type = "child";
            subCheckbox.dataset.parentId = category.id;

            // Восстанавливаем состояние выборки
            if (currentSelectedIds.has(sub.id) || currentSelectedIds.has(category.id)) {
                subCheckbox.checked = true;
            }

            const subLabel = document.createElement("span");
            subLabel.className = "ind-sub-label ind-label"; // Используем те же стили
            subLabel.innerText = sub.name;
            if (filterText && sub.name.toLowerCase().includes(filterText)) {
                subLabel.style.color = "#fff"; // Чуть ярче
                subLabel.style.fontWeight = "500";
            }

            // Клик по тексту -> чекбокс
            subLabel.onclick = () => { subCheckbox.checked = !subCheckbox.checked; updateState(); };

            subDiv.appendChild(subCheckbox);
            subDiv.appendChild(subLabel);
            childrenContainer.appendChild(subDiv);

            // Листенеры изменения
            subCheckbox.addEventListener("change", () => {
                updateState();
            });
        });

        catDiv.appendChild(childrenContainer);
        container.appendChild(catDiv);

        // --- ЛОГИКА ---

        // Состояние родительского чекбокса (Indeterminate)
        updateParentCheckboxState(catCheckbox, childrenContainer);

        // 1. Клик по Иконке -> Раскрытие
        toggleIcon.onclick = (e) => {
            e.stopPropagation(); // Чтобы не триггерить клик по хедерам, если будут
            childrenContainer.classList.toggle("open");
            toggleIcon.classList.toggle("expanded");
        };

        // 2. Клик по Тексту Родителя -> Тоже раскрытие? Или выбор?
        // Юзер: "нужно нажать на иконку... и список раскрывается".
        // Обычно клик по тексту тоже раскрывает. Сделаем раскрытие.
        catLabel.onclick = () => {
            childrenContainer.classList.toggle("open");
            toggleIcon.classList.toggle("expanded");
        };

        // 3. Клик по Чекбоксу Родителя -> Выбрать все/Снять все
        catCheckbox.addEventListener("change", () => {
            const childrenInputs = childrenContainer.querySelectorAll("input[data-type='child']");
            childrenInputs.forEach(ch => ch.checked = catCheckbox.checked);
            updateState(); // Обновляем Set
        });

        // Функция обновления сета (вызывается при любом клике)
        function updateState() {
            // Обновляем визуал родителя
            updateParentCheckboxState(catCheckbox, childrenContainer);

            // Синхронизируем currentSelectedIds
            // Проходим по всем чекбоксам в ЭТОЙ категории (оптимизация)
            // Но лучше глобально собрать в конце перед сохранением. 
            // А здесь просто обновлять UI.

            // Но нам нужно state хранить актуальным для поиска и перерендера.
            // Поэтому давайте обновлять Set прямо здесь.

            const childrenInputs = childrenContainer.querySelectorAll("input[data-type='child']");
            childrenInputs.forEach(ch => {
                if (ch.checked) currentSelectedIds.add(ch.value);
                else currentSelectedIds.delete(ch.value);
            });

            // Родителя тоже можно добавить в сет, если он checked (для красоты), 
            // но API принимает либо ID родителя, либо массив детей.
            // Важно: если выбран родитель, то currentSelectedIds должен содержать его ID?
            // Или лучше хранить только детей и вычислять родителя?
            // HH API: если передать ID категории, он ищет по всей категории.
            if (catCheckbox.checked && !catCheckbox.indeterminate) {
                currentSelectedIds.add(category.id);
            } else {
                currentSelectedIds.delete(category.id);
            }
        }
    });
}

function updateParentCheckboxState(parentCheckbox, childrenContainer) {
    const children = Array.from(childrenContainer.querySelectorAll("input"));
    if (children.length === 0) return; // Нет детей

    const checkedCount = children.filter(c => c.checked).length;

    if (checkedCount === 0) {
        parentCheckbox.checked = false;
        parentCheckbox.indeterminate = false;
    } else if (checkedCount === children.length) {
        // Все выбраны - значит родитель выбран полностью
        parentCheckbox.checked = true;
        parentCheckbox.indeterminate = false;
    } else {
        // Частично
        parentCheckbox.checked = false;
        parentCheckbox.indeterminate = true;
    }
}

// Сбор финальный (перед отправкой)
function getFinalSelectedIds() {
    // В currentSelectedIds у нас сейчас может быть каша (и дети, и родители).
    // Нам нужно нормализовать:
    // 1. Если выбраны ВСЕ дети категории -> заменяем их на ID категории.
    // 2. Если выбрана ЧАСТЬ -> шлем ID детей.

    // Но так как currentSelectedIds мы обновляли "на лету" довольно грубо,
    // лучше пробежаться по DOM сейчас, так надежнее.

    const container = document.getElementById("industryTree");
    const parents = container.querySelectorAll("input[data-type='parent']");
    const resultIds = [];

    parents.forEach(p => {
        if (p.checked && !p.indeterminate) {
            resultIds.push(p.value); // Вся категория
        } else {
            // Иначе смотрим детей
            // (p.parentElement это header, p.parentElement.nextSibling это childrenContainer)
            const childrenContainer = p.parentElement.nextElementSibling;
            if (childrenContainer) {
                const checkedChildren = childrenContainer.querySelectorAll("input[data-type='child']:checked");
                checkedChildren.forEach(c => resultIds.push(c.value));
            }
        }
    });

    return resultIds;
}


async function saveSettings(userId, sign) {
    const salaryInput = document.getElementById("salaryInput");
    const noSalaryCheckbox = document.getElementById("noSalaryCheckbox");

    let salary = null;

    if (!noSalaryCheckbox.checked) {
        let val = salaryInput.value.trim();
        if (val === "") {
            showError("Введите сумму или поставьте галочку 'Не указывать'");
            return;
        }
        salary = parseInt(val);
        if (isNaN(salary) || salary < 0) {
            showError("Зарплата должна быть положительным числом!");
            return;
        }
        if (salary > 100000000) {
            showError("Зарплата не может превышать 100 млн ₽");
            return;
        }
    }

    const experience = document.getElementById("experienceSelect").value;

    // Получаем ID из DOM (наиболее актуально)
    // Внимание: если был фильтр и часть дерева скрыта, getFinalSelectedIds не найдет их в DOM?
    // ДА! Это проблема. При фильтрации мы перерисовываем дерево и теряем скрытые элементы.
    // РЕШЕНИЕ: Нам нужно полагаться на currentSelectedIds, который должен быть Source of Truth.

    // Но currentSelectedIds хранит flat list (и родителей и детей).
    // Нам нужно его почистить перед отправкой.
    const selectedIndustries = finalizeIdsFromSet();

    // ПРОВЕРКА НА ИЗМЕНЕНИЯ
    let initialSal = initialSettings.salary;
    if (initialSal === 0) initialSal = null;
    const initInd = initialSettings.industry || [];
    const isIndChanged = JSON.stringify(selectedIndustries.sort()) !== JSON.stringify(initInd.sort());

    if (salary === initialSal && experience === initialSettings.experience && !isIndChanged) {
        alert("Данные не изменились 🤷‍♂️");
        return;
    }

    const payload = {
        user_id: parseInt(userId),
        sign: sign,
        salary: salary,
        experience: experience,
        industry: selectedIndustries
    };

    const response = await fetch(`${API_BASE_URL}/api/settings/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (data.status !== "ok") {
        throw new Error(data.error || "Ошибка сервера");
    }

    // Показываем уведомление
    const saveBtn = document.getElementById("saveBtn");
    const originalText = saveBtn.innerText;
    saveBtn.innerText = "Сохранено! ✅";
    saveBtn.style.background = "#4caf50";
    setTimeout(() => {
        saveBtn.innerText = originalText;
        saveBtn.style.background = "linear-gradient(45deg, #a962ff, #6247aa)";
    }, 2000);

    // Обновляем "начальное" состояние
    initialSettings = {
        salary: salary,
        experience: experience,
        industry: selectedIndustries
    };

    document.getElementById("errorMsg").style.display = "none";
}

function finalizeIdsFromSet() {
    // Превращаем Set в "умный список" (Родитель заменяет Детей)
    const result = [];
    const set = currentSelectedIds;

    allIndustries.forEach(cat => {
        // Проверяем всех детей категории
        const children = cat.industries || [];
        if (children.length === 0) return;

        const allChildrenIds = children.map(c => c.id);
        const selectedChildrenIds = allChildrenIds.filter(id => set.has(id));

        if (selectedChildrenIds.length === allChildrenIds.length) {
            // Если выбраны ВСЕ дети -> добавляем ID родителя
            result.push(cat.id);
        } else {
            // Иначе добавляем только выбранных детей
            // Нужно ли проверять, если в сете лежит сам cat.id? 
            // Если лежит cat.id, считаем что все выбраны.
            if (set.has(cat.id)) {
                result.push(cat.id);
            } else {
                result.push(...selectedChildrenIds);
            }
        }
    });

    return result;
}

function showError(msg) {
    const errDiv = document.getElementById("errorMsg");
    errDiv.innerText = msg;
    errDiv.style.display = "block";
}
