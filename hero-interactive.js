/**
 * Интерактивная демо-панель hero variant B.
 */
(function () {
  'use strict';

  var FEED = [
    { role: 'Backend-разработчик (Python)', company: 'Тинькофф', match: 78, sent: true, reason: 'Совпадение по Python, FastAPI и PostgreSQL' },
    { role: 'Middle Python Developer', company: 'Авито', match: 41, sent: false, reason: 'Ищут junior с опытом до 2 лет' },
    { role: 'Senior Backend Engineer', company: 'Ozon Tech', match: 86, sent: true, reason: 'Совпадение по микросервисам и Kafka' },
    { role: 'Разработчик API', company: 'СберТех', match: 35, sent: false, reason: 'Нужен другой стек: Java + Spring' },
    { role: 'Python-разработчик', company: 'Яндекс', match: 72, sent: true, reason: 'Совпадение по навыкам и домену fintech' },
    { role: 'Backend Developer', company: 'VK', match: 48, sent: false, reason: 'Требуется релокация в офис' },
    { role: 'Инженер платформы', company: 'Wildberries', match: 81, sent: true, reason: 'Совпадение по highload и CI/CD' },
    { role: 'Python Engineer', company: 'Райффайзен', match: 67, sent: true, reason: 'Банковский домен и опыт с API' },
    { role: 'Software Engineer', company: 'Лаборатория Касперского', match: 44, sent: false, reason: 'Зарплата ниже вашего фильтра' },
    { role: 'Backend-разработчик', company: '2ГИС', match: 74, sent: true, reason: 'Совпадение по Django и геоданным' },
    { role: 'Senior Python Dev', company: 'МТС Digital', match: 69, sent: true, reason: 'Совпадение по async и Kubernetes' },
    { role: 'Разработчик', company: 'HeadHunter', match: 52, sent: true, reason: 'Совпадение по продуктовой разработке' },
    { role: 'Platform Engineer', company: 'X5 Tech', match: 38, sent: false, reason: 'Ищут специалиста с Go, не Python' },
    { role: 'Backend-разработчик', company: 'Самокат', match: 77, sent: true, reason: 'Совпадение по навыкам и удалёнке' },
    { role: 'Python Developer', company: 'Циан', match: 71, sent: true, reason: 'Совпадение по стеку и опыту в продукте' }
  ];

  var MANUAL_JOBS = [
    { role: 'Senior Python Developer', company: 'Тинькофф', salary: 'до 420 000 ₽', match: 88 },
    { role: 'Backend Engineer', company: 'Авито', salary: 'до 380 000 ₽', match: 76 },
    { role: 'Разработчик API', company: 'Ozon', salary: 'до 350 000 ₽', match: 82 },
    { role: 'Python-разработчик', company: 'Яндекс', salary: 'до 400 000 ₽', match: 79 },
    { role: 'Platform Engineer', company: 'VK', salary: 'до 360 000 ₽', match: 71 },
    { role: 'Backend Developer', company: 'Сбер', salary: 'до 340 000 ₽', match: 68 },
    { role: 'Инженер данных', company: 'Wildberries', salary: 'до 330 000 ₽', match: 64 },
    { role: 'Python Engineer', company: '2ГИС', salary: 'до 310 000 ₽', match: 73 },
    { role: 'Senior Backend', company: 'HeadHunter', salary: 'до 370 000 ₽', match: 80 },
    { role: 'Backend-разработчик', company: 'МТС', salary: 'до 320 000 ₽', match: 70 }
  ];

  var COVER_LETTER =
    'Здравствуйте!\n\n' +
    'Меня заинтересовала вакансия — мой опыт в разработке высоконагруженных Python-сервисов ' +
    'хорошо совпадает с вашими требованиями. За последние 4 года я проектировал API, ' +
    'оптимизировал PostgreSQL и выводил микросервисы в прод.\n\n' +
    'Буду рад обсудить, как мой опыт поможет вашей команде. Готов к собеседованию в удобное время.\n\n' +
    'С уважением,\nАлександр';

  var COVER_STORAGE = 'auroraHeroCoverCount';

  var inited = false;
  var activeTab = 'auto';
  var autoState = 'idle';
  var streamTimer = null;
  var feedIndex = 0;
  var sentCount = 0;
  var checkedCount = 0;
  var foundTotal = 0;
  var coverCount = 0;
  var manualShown = false;

  var els = {};

  function $(id) { return document.getElementById(id); }

  function syncHeight() {
    var wrap = els.liveWrap;
    if (!wrap) return;
    var pane = wrap.querySelector('.pane.is-active');
    if (!pane) return;
    wrap.style.height = pane.scrollHeight + 'px';
  }

  function setRing(value, max, label) {
    if (!els.ringNum || !els.ringSub) return;
    els.ringNum.textContent = String(value);
    els.ringSub.textContent = label || ('из ' + max);
    var pct = max > 0 ? Math.min(1, value / max) : 0;
    var circ = 2 * Math.PI * 52;
    if (els.ringProg) {
      els.ringProg.style.strokeDashoffset = String(circ * (1 - pct));
    }
  }

  function updateHead() {
    if (activeTab === 'auto') {
      els.headTitle.textContent = 'Сделано откликов';
      if (autoState === 'idle') {
        els.headSub.textContent = 'Автопилот неактивен';
        els.mainBtn.textContent = 'Запустить автопилот';
        els.mainBtn.classList.remove('is-muted', 'is-stop');
        els.mainHint.classList.add('hidden');
      } else if (autoState === 'running') {
        els.headSub.textContent = 'Автопилот работает…';
        els.mainBtn.textContent = 'Остановить автопилот';
        els.mainBtn.classList.add('is-stop');
        els.mainBtn.classList.remove('is-muted');
        els.mainHint.classList.add('hidden');
      } else {
        els.headSub.textContent = 'Дневной лимит достигнут';
        els.mainBtn.textContent = 'Остановить автопилот';
        els.mainBtn.classList.add('is-stop', 'is-muted');
        els.mainHint.textContent = 'Автопилот продолжит работу завтра в 9:00';
        els.mainHint.classList.remove('hidden');
      }
      setRing(sentCount, 10, 'из 10');
    } else if (activeTab === 'manual') {
      els.headTitle.textContent = 'Ручной поиск';
      els.headSub.textContent = manualShown ? '10 вакансий в подборке' : 'Покажите подборку вакансий';
      els.mainBtn.textContent = 'Показать вакансии';
      els.mainBtn.classList.remove('is-stop', 'is-muted');
      els.mainHint.classList.add('hidden');
      setRing(manualShown ? 10 : 0, 10, 'из 10');
    } else {
      els.headTitle.textContent = 'Сопроводительные';
      els.headSub.textContent = 'Генерация под вакансию';
      els.mainBtn.textContent = 'Создать сопровод';
      els.mainBtn.classList.remove('is-stop', 'is-muted');
      els.mainHint.classList.add('hidden');
      setRing(coverCount, 100, 'из 100');
    }
  }

  function appendLogLine(html) {
    var line = document.createElement('div');
    line.className = 'term-line';
    line.innerHTML = html;
    els.autoTerm.appendChild(line);
    els.autoTerm.scrollTop = els.autoTerm.scrollHeight;
    syncHeight();
  }

  function resetAutoLog() {
    els.autoTerm.innerHTML = '';
    sentCount = 0;
    checkedCount = 0;
    feedIndex = 0;
    els.stSent.textContent = '0';
    els.stChecked.textContent = '0';
    els.stSaved.textContent = '0';
  }

  function stopStream() {
    if (streamTimer) {
      clearTimeout(streamTimer);
      streamTimer = null;
    }
    autoState = 'idle';
    updateHead();
  }

  function streamNext() {
    if (autoState !== 'running') return;

    if (sentCount >= 10) {
      appendLogLine(
        '<span class="term-done">На сегодня отправлено 10 откликов из 10. ' +
        'Завтра в 9:00 автопилот продолжит работу.</span>'
      );
      autoState = 'done';
      updateHead();
      return;
    }

    while (feedIndex < FEED.length && sentCount < 10) {
      var item = FEED[feedIndex++];
      checkedCount++;
      els.stChecked.textContent = String(checkedCount);
      els.stSaved.textContent = String(Math.min(6, Math.floor(checkedCount * 0.4)));

      if (item.sent) {
        sentCount++;
        els.stSent.textContent = String(sentCount);
        appendLogLine(
          '<span class="term-ok">✓ Отклик отправлен · ' + item.role + ', ' + item.company +
          ' — мэтч ' + item.match + '%</span>' +
          '<span class="term-reason">' + item.reason + '</span>'
        );
        setRing(sentCount, 10, 'из 10');
        if (sentCount >= 10) {
          streamTimer = setTimeout(streamNext, 520);
          return;
        }
      } else {
        appendLogLine(
          '<span class="term-skip">→ Пропущено · ' + item.role + ', ' + item.company +
          ' — мэтч ' + item.match + '%</span>' +
          '<span class="term-reason">' + item.reason + '</span>'
        );
      }

      streamTimer = setTimeout(streamNext, 380 + Math.random() * 280);
      return;
    }

    if (sentCount >= 10) {
      streamNext();
    } else {
      autoState = 'done';
      updateHead();
    }
  }

  function startAutopilot() {
    resetAutoLog();
    foundTotal = 200 + Math.floor(Math.random() * 51);
    appendLogLine(
      '<span class="term-head">Найдено ' + foundTotal + ' вакансий по вашим фильтрам</span>'
    );
    autoState = 'running';
    updateHead();
    streamTimer = setTimeout(streamNext, 600);
  }

  function onMainBtn() {
    if (activeTab === 'auto') {
      if (autoState === 'idle') {
        startAutopilot();
      } else {
        stopStream();
        resetAutoLog();
        els.autoTerm.innerHTML = '<div class="term-hint">Нажмите «Запустить автопилот», чтобы увидеть демо</div>';
        syncHeight();
      }
    } else if (activeTab === 'manual') {
      if (manualShown) return;
      manualShown = true;
      els.manualEmpty.hidden = true;
      els.manualList.hidden = false;
      els.manualList.innerHTML = '';
      MANUAL_JOBS.forEach(function (job, i) {
        var card = document.createElement('div');
        card.className = 'manual-card';
        card.style.animationDelay = (i * 0.06) + 's';
        card.innerHTML =
          '<div class="manual-card-top">' +
            '<strong>' + job.role + '</strong>' +
            '<span class="manual-match">' + job.match + '%</span>' +
          '</div>' +
          '<div class="manual-card-meta">' + job.company + ' · ' + job.salary + '</div>';
        els.manualList.appendChild(card);
      });
      updateHead();
      syncHeight();
    } else {
      if (els.coverLoader && !els.coverLoader.hidden) return;
      els.coverLetter.hidden = true;
      els.coverLoader.hidden = false;
      if (els.coverEmpty) els.coverEmpty.hidden = true;
      syncHeight();
      var delay = 1500 + Math.random() * 300;
      setTimeout(function () {
        els.coverLoader.hidden = true;
        els.coverLetter.hidden = false;
        els.coverLetter.textContent = COVER_LETTER;
        coverCount++;
        try { localStorage.setItem(COVER_STORAGE, String(coverCount)); } catch (e) {}
        updateHead();
        syncHeight();
      }, delay);
    }
  }

  function switchTab(tab) {
    activeTab = tab;
    els.tabBtns.forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.tab === tab);
    });
    els.panes.forEach(function (pane) {
      pane.classList.toggle('is-active', pane.dataset.tab === tab);
    });
    updateHead();
    requestAnimationFrame(function () {
      requestAnimationFrame(syncHeight);
    });
  }

  function collectEls() {
    els.liveWrap = $('liveWrap');
    els.autoTerm = $('autoTerm');
    els.manualEmpty = $('manualEmpty');
    els.manualList = $('manualList');
    els.coverEmpty = $('coverEmpty');
    els.coverLoader = $('coverLoader');
    els.coverLetter = $('coverLetter');
    els.headTitle = $('demoHeadTitle');
    els.headSub = $('demoHeadSub');
    els.mainBtn = $('demoMainBtn');
    els.mainHint = $('demoMainHint');
    els.ringNum = $('demoRingNum');
    els.ringSub = $('demoRingSub');
    els.ringProg = $('demoRingProg');
    els.stSent = $('stSent');
    els.stChecked = $('stChecked');
    els.stSaved = $('stSaved');
    els.tabBtns = Array.prototype.slice.call(document.querySelectorAll('.demo-tab'));
    els.panes = Array.prototype.slice.call(document.querySelectorAll('#liveWrap .pane'));
  }

  function init() {
    if (inited) {
      syncHeight();
      return;
    }
    var root = $('hero-variant-b');
    if (!root || root.hidden) return;

    collectEls();
    if (!els.liveWrap) return;

    try {
      var saved = parseInt(localStorage.getItem(COVER_STORAGE) || '0', 10);
      if (!isNaN(saved) && saved > 0) coverCount = saved;
    } catch (e) {}

    els.mainBtn.addEventListener('click', onMainBtn);
    els.tabBtns.forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.dataset.tab); });
    });

    updateHead();
    inited = true;

    requestAnimationFrame(function () {
      syncHeight();
      window.addEventListener('resize', syncHeight);
    });
  }

  window.HeroInteractive = { init: init, syncHeight: syncHeight };
})();
