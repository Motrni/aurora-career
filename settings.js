
// settings.js

// КОНФИГУРАЦИЯ
// Замените на реальный адрес вашего бота (API)
const API_BASE_URL = "https://api.aurora-career.ru";

// Храним начальное состояние для проверки изменений
let initialSettings = {};

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Получаем параметры из URL
    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('user_id');
    const sign = urlParams.get('sign');

    if (!userId || !sign) {
        showError("Ошибка доступа. Ссылка не содержит необходимых параметров.");
        return;
    }

    // ЛОГИКА ЧЕКБОКСА (UI)
    const salaryInput = document.getElementById("salaryInput");
    const noSalaryCheckbox = document.getElementById("noSalaryCheckbox");

    // Обработчик изменения чекбокса
    noSalaryCheckbox.addEventListener("change", (e) => {
        if (e.target.checked) {
            salaryInput.value = ""; // Очищаем поле
            salaryInput.disabled = true; // Блокируем ввод
            salaryInput.placeholder = "Не указана";
            // Убираем класс ошибки если был
            salaryInput.style.borderColor = "#333";
        } else {
            salaryInput.disabled = false; // Разблокируем
            salaryInput.placeholder = "Например: 100000";
            salaryInput.focus();
        }
    });

    try {
        await loadSettings(userId, sign);
    } catch (e) {
        showError("Не удалось загрузить настройки. " + e.message);
    }

    document.getElementById("saveBtn").addEventListener("click", async () => {
        try {
            await saveSettings(userId, sign);
        } catch (e) {
            showError("Ошибка при сохранении. " + e.message);
        }
    });
});

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
    const salaryInput = document.getElementById("salaryInput");
    const noSalaryCheckbox = document.getElementById("noSalaryCheckbox");

    // Логика отображения зарплаты
    // Если null или 0 -> ставим галочку "Не указывать"
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

    if (settings.experience) document.getElementById("experienceSelect").value = settings.experience;

    if (settings.search_area) {
        document.getElementById("cityStatus").innerText = `Текущий регион ID: ${settings.search_area}`;
    }

    // Сохраняем начальное состояние
    initialSettings = {
        salary: settings.salary || null, // Сохраняем как null если 0/undefined
        experience: settings.experience || "noExperience"
    };
    // Если было 0, нормализуем в null для единообразия
    if (initialSettings.salary === 0) initialSettings.salary = null;
}

async function saveSettings(userId, sign) {
    const salaryInput = document.getElementById("salaryInput");
    const noSalaryCheckbox = document.getElementById("noSalaryCheckbox");

    let salary = null; // По умолчанию null

    // Если галочка НЕ стоит, берем значение из инпута
    if (!noSalaryCheckbox.checked) {
        let val = salaryInput.value.trim();
        if (val === "") {
            showError("Введите сумму или поставьте галочку 'Не указывать'");
            return;
        }
        salary = parseInt(val);

        // ВАЛИДАЦИЯ
        if (isNaN(salary) || salary < 0) {
            showError("Зарплата должна быть положительным числом!");
            return;
        }
        if (salary > 100000000) {
            showError("Зарплата не может превышать 100 млн ₽");
            return;
        }
    }
    // Иначе salary остается null

    const experience = document.getElementById("experienceSelect").value;

    // ПРОВЕРКА НА ИЗМЕНЕНИЯ (Идемпотентность)

    // Нормализуем начальное значение
    let initialSal = initialSettings.salary;
    if (initialSal === 0) initialSal = null;

    if (salary === initialSal && experience === initialSettings.experience) {
        alert("Данные не изменились 🤷‍♂️");
        return;
    }

    const payload = {
        user_id: parseInt(userId),
        sign: sign,
        salary: salary,
        experience: experience
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

    alert("Настройки успешно сохранены! ✅");

    // Обновляем "начальное" состояние
    initialSettings = {
        salary: salary,
        experience: experience
    };

    // Скрываем ошибку
    document.getElementById("errorMsg").style.display = "none";
}

function showError(msg) {
    const errDiv = document.getElementById("errorMsg");
    errDiv.innerText = msg;
    errDiv.style.display = "block";
}
