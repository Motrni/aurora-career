
// settings.js

// КОНФИГУРАЦИЯ
// Замените на реальный адрес вашего бота (API)
const API_BASE_URL = "https://api.aurora-career.ru";

// Храним начальное состояние для проверки изменений
let initialSettings = {};

document.addEventListener("DOMContentLoaded", async () => {
    // ... (код получения URL параметров тот же) ...
    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('user_id');
    const sign = urlParams.get('sign');

    if (!userId || !sign) {
        showError("Ошибка доступа. Ссылка не содержит необходимых параметров.");
        return;
    }

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

    // Заполняем форму
    if (settings.salary) document.getElementById("salaryInput").value = settings.salary;
    if (settings.experience) document.getElementById("experienceSelect").value = settings.experience;

    if (settings.search_area) {
        document.getElementById("cityStatus").innerText = `Текущий регион ID: ${settings.search_area}`;
    }

    // Сохраняем начальное состояние (для сравнения)
    initialSettings = {
        salary: settings.salary || "",
        experience: settings.experience || "noExperience"
    };
}

async function saveSettings(userId, sign) {
    const salaryInput = document.getElementById("salaryInput");
    // Если пусто, считаем как 0 или null, но input type=number может вернуть ""
    let salaryVal = salaryInput.value.trim();
    let salary = salaryVal === "" ? 0 : parseInt(salaryVal);

    // ВАЛИДАЦИЯ
    if (isNaN(salary) || salary < 0) {
        showError("Зарплата должна быть положительным числом!");
        return;
    }
    // Лимит 100 млн
    if (salary > 100000000) {
        showError("Зарплата не может превышать 100 млн ₽");
        return;
    }

    const experience = document.getElementById("experienceSelect").value;

    // ПРОВЕРКА НА ИЗМЕНЕНИЯ (Идемпотентность)
    // Приводим к единому типу для сравнения
    const initialSal = initialSettings.salary ? parseInt(initialSettings.salary) : 0;

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

    // Обновляем "начальное" состояние до текущего
    initialSettings = {
        salary: salary,
        experience: experience
    };

    // Скрываем ошибку, если была
    document.getElementById("errorMsg").style.display = "none";
}

function showError(msg) {
    const errDiv = document.getElementById("errorMsg");
    errDiv.innerText = msg;
    errDiv.style.display = "block";
}
