/**
 * Интерактивная демо-панель hero variant B (логика из aurora-hero-interactive.html).
 */
(function () {
  'use strict';

  var COVER_STORAGE = 'auroraHeroCoverCount';

  var liveWrap, goBtn, goNote, stTitle, stDesc, ringN, ringD;
  var tab = 'auto';
  var busy = false;
  var autoState = 'idle';
  var autoRun = false;
  var inited = false;

  var cfg = {
    auto: {
      title: 'Автопилот готов к запуску',
      desc: 'Найдёт релевантные вакансии и отправит отклики за вас. Жмите «Запустить».'
    },
    manual: {
      btn: 'Показать вакансии',
      title: 'Ручной поиск вакансий',
      desc: 'Вакансии подбираются по вашим фильтрам. Жмите, чтобы увидеть подборку.'
    },
    cover: {
      btn: 'Создать сопровод',
      title: 'Сопроводительные письма',
      desc: 'Персональное письмо под вакансию — одной кнопкой.'
    }
  };

  var state = {
    auto: { ringN: 0, ringD: 'из 10' },
    manual: { ringN: 243, ringD: 'найдено' },
    cover: { ringN: 0, ringD: 'из 100' }
  };

  var AUTO_STEP_MS = 465;

  function maybeCenterAutopilotPanel() {
    if (window.scrollY > 100) return;
    var panel = document.querySelector('#hero-variant-b .panel');
    if (!panel || !liveWrap) return;

    // live-wrap анимирует height 0→N за ~0.42s. Без этого центр считается
    // по свёрнутой панели и после раскрытия лога она оказывается ниже экрана.
    var savedTransition = liveWrap.style.transition;
    liveWrap.style.transition = 'none';
    fit();
    void panel.offsetHeight;
    liveWrap.style.transition = savedTransition;

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var rect = panel.getBoundingClientRect();
        var panelCenter = rect.top + rect.height / 2;
        var viewCenter = window.innerHeight / 2;
        var threshold = window.innerHeight * 0.3;
        if (Math.abs(panelCenter - viewCenter) <= threshold) return;
        var targetY = Math.max(0, window.scrollY + panelCenter - viewCenter);
        window.scrollTo({ top: targetY, behavior: 'smooth' });
      });
    });
  }

  function showDemoCompleteModal() {
    setTimeout(function () {
      if (typeof window.openHeroDemoModal === 'function') {
        window.openHeroDemoModal();
      }
    }, 850);
  }

  var feed = [
    { role: 'QA Engineer', co: 'Альфа-Банк', pct: 91, ok: true, r: 'опыт в банке закрывает требования' },
    { role: 'Junior QA Tester', co: 'Стартап Nova', pct: 34, ok: false, r: 'ищут junior, вы — senior' },
    { role: 'QA Automation', co: '2GIS', pct: 88, ok: true, r: 'ваш стек на Python совпал' },
    { role: 'SDET (Java)', co: 'Корп-проект', pct: 46, ok: false, r: 'нужен глубокий Java, у вас — Python' },
    { role: 'Ведущий тестировщик', co: 'BetBoom', pct: 84, ok: true, r: 'совпадение по ключевым навыкам' },
    { role: 'QA Lead (релокация)', co: 'ESSG', pct: 41, ok: false, r: 'требуется переезд, у вас — удалёнка' },
    { role: 'QA Tech Expert', co: 'Pay Digital', pct: 79, ok: true, r: 'мобайл + блокчейн — ваш профиль' },
    { role: 'Manual QA', co: 'Аутсорс Гамма', pct: 38, ok: false, r: 'зарплата ниже вашего фильтра' },
    { role: 'QA Backend', co: 'Haier', pct: 72, ok: true, r: 'PostgreSQL и Kafka — в плюс' },
    { role: 'QA Engineer', co: 'Yandex', pct: 81, ok: true, r: 'микросервисы — ваш опыт' },
    { role: 'Тестировщик 1С', co: 'Интегратор', pct: 29, ok: false, r: 'другой стек (1С), не ваш профиль' },
    { role: 'QA Mobile', co: 'Pay Digital', pct: 68, ok: true, r: 'мобильное тестирование совпало' },
    { role: 'QA Automation', co: 'IBS', pct: 76, ok: true, r: 'опыт автоматизации подошёл' },
    { role: 'QA Analyst', co: 'СберТех', pct: 83, ok: true, r: 'аналитика и API — ваш конёк' },
    { role: 'QA Engineer (Senior)', co: 'Каспийский банк', pct: 74, ok: true, r: 'банковский домен — точное попадание' }
  ];

  function pane(n) {
    return liveWrap.querySelector('.pane[data-pane="' + n + '"]');
  }

  function fit() {
    if (!liveWrap) return;
    var p = pane(tab);
    if (p) liveWrap.style.height = p.scrollHeight + 'px';
  }

  function syncHead() {
    var c = cfg[tab];
    var s = state[tab];
    stTitle.textContent = c.title;
    stDesc.textContent = c.desc;
    ringN.textContent = s.ringN;
    ringD.textContent = s.ringD;
    if (tab === 'auto') {
      goBtn.textContent = autoState === 'idle' ? 'Запустить автопилот' : 'Остановить автопилот';
      goBtn.classList.toggle('stop', autoState !== 'idle');
      goNote.textContent = autoState === 'done' ? 'Автопилот продолжит работу завтра в 9:00' : '';
    } else {
      goBtn.textContent = c.btn;
      goBtn.classList.remove('stop');
      goNote.textContent = '';
    }
  }

  function startAuto() {
    autoState = 'running';
    autoRun = true;
    syncHead();
    state.auto.ringN = 0;
    if (tab === 'auto') ringN.textContent = '0';

    var found = 200 + Math.floor(Math.random() * 51);
    var p = pane('auto');
    p.innerHTML =
      '<div class="term" id="term"><div class="l hd">Найдено ' + found +
      ' вакансий. Оцениваю соответствие профилю…</div></div>' +
      '<div class="stat-row"><div class="stat"><div class="lb">Отправлено</div><div class="nm" id="s1">0</div></div>' +
      '<div class="stat"><div class="lb">Проверено</div><div class="nm" id="s2">0</div></div>' +
      '<div class="stat"><div class="lb">Время вручную</div><div class="nm" id="s3">0 ч</div></div></div>';

    var term = document.getElementById('term');
    var i = 0;
    var sent = 0;
    fit();
    maybeCenterAutopilotPanel();

    (function step() {
      if (!autoRun) return;
      if (i >= feed.length || sent >= 10) {
        var f = document.createElement('div');
        f.className = 'l fin';
        f.textContent = 'На сегодня отправлено 10 откликов из 10. Завтра в 9:00 автопилот продолжит работу.';
        term.appendChild(f);
        term.scrollTop = term.scrollHeight;
        state.auto.ringN = 10;
        if (tab === 'auto') ringN.textContent = '10';
        autoState = 'done';
        autoRun = false;
        syncHead();
        fit();
        showDemoCompleteModal();
        return;
      }
      var v = feed[i];
      var d = document.createElement('div');
      d.className = 'l';
      if (v.ok) {
        sent++;
        d.innerHTML =
          '<span class="ok">✓ Отклик отправлен</span> · ' + v.role + ', ' + v.co +
          ' — мэтч ' + v.pct + '%<span class="rs">' + v.r + '</span>';
        state.auto.ringN = sent;
        if (tab === 'auto') ringN.textContent = String(sent);
        document.getElementById('s1').textContent = String(sent);
      } else {
        d.innerHTML =
          '<span class="sk">→ Пропущено</span> · ' + v.role + ', ' + v.co +
          ' — мэтч ' + v.pct + '%<span class="rs">' + v.r + '</span>';
      }
      term.appendChild(d);
      term.scrollTop = term.scrollHeight;
      i++;
      document.getElementById('s2').textContent = String(Math.min(found, 15 + i * 16));
      document.getElementById('s3').textContent = (i * 0.4).toFixed(1) + ' ч';
      fit();
      setTimeout(step, AUTO_STEP_MS);
    })();
  }

  function stopAuto() {
    autoRun = false;
    autoState = 'idle';
    syncHead();
  }

  function runManual() {
    busy = true;
    var p = pane('manual');
    var vac = [
      ['Альфа-Банк', 'Ведущий тестировщик', '94%'],
      ['2GIS', 'QA Engineer', '91%'],
      ['BetBoom', 'QA Automation', '88%'],
      ['Pay Digital', 'QA Tech Expert', '85%'],
      ['СберТех', 'QA Analyst', '82%'],
      ['Haier', 'QA Backend', '80%'],
      ['IBS', 'QA Automation', '78%'],
      ['Yandex', 'QA Engineer', '77%'],
      ['Каспийский банк', 'QA Senior', '75%'],
      ['Ozon', 'QA Mobile', '73%']
    ];
    p.innerHTML = '<div class="vac-list" id="vl"></div>';
    var vl = document.getElementById('vl');
    fit();
    vac.forEach(function (v, idx) {
      setTimeout(function () {
        var d = document.createElement('div');
        d.className = 'vac';
        d.innerHTML =
          '<div class="ico">💼</div><div><b>' + v[1] + '</b><p>' + v[0] +
          '</p></div><div class="resp">мэтч ' + v[2] + '</div>';
        vl.appendChild(d);
        fit();
        if (idx === vac.length - 1) busy = false;
      }, idx * 150);
    });
  }

  function runCover() {
    busy = true;
    var p = pane('cover');
    p.innerHTML =
      '<div class="loader"><div class="spin"></div><div class="lt">Аврора генерирует письмо под вакансию…</div></div>';
    fit();
    setTimeout(function () {
      var txt =
        'Здравствуйте!\n\nУвидел вашу вакансию «Ведущий тестировщик» и откликаюсь с интересом. ' +
        'За 5+ лет в QA выстраивал процессы тестирования в банковских системах, автоматизировал регресс ' +
        'и снижал time-to-release.\n\nГотов обсудить, чем буду полезен вашей команде.\n\nС уважением,\nВадим';
      p.innerHTML = '<div class="letter">' + txt + '</div>';
      state.cover.ringN += 1;
      try { localStorage.setItem(COVER_STORAGE, String(state.cover.ringN)); } catch (e) {}
      if (tab === 'cover') ringN.textContent = String(state.cover.ringN);
      fit();
      busy = false;
    }, 1600);
  }

  function onGoClick() {
    if (tab === 'auto') {
      if (autoState === 'idle') startAuto();
      else stopAuto();
      return;
    }
    if (busy) return;
    if (tab === 'manual') runManual();
    else runCover();
  }

  function init() {
    var root = document.getElementById('hero-variant-b');
    if (!root) return;

    liveWrap = document.getElementById('liveWrap');
    goBtn = document.getElementById('goBtn');
    goNote = document.getElementById('goNote');
    stTitle = document.getElementById('stTitle');
    stDesc = document.getElementById('stDesc');
    ringN = document.getElementById('ringN');
    ringD = document.getElementById('ringD');
    if (!liveWrap || !goBtn) return;

    if (!inited) {
      try {
        var saved = parseInt(localStorage.getItem(COVER_STORAGE) || '0', 10);
        if (!isNaN(saved) && saved > 0) state.cover.ringN = saved;
      } catch (e) {}

      document.querySelectorAll('#hero-variant-b .tab').forEach(function (t) {
        t.addEventListener('click', function () {
          document.querySelectorAll('#hero-variant-b .tab').forEach(function (x) {
            x.classList.remove('active');
          });
          t.classList.add('active');
          liveWrap.querySelectorAll('.pane').forEach(function (p) {
            p.classList.remove('active');
          });
          tab = t.dataset.tab;
          pane(tab).classList.add('active');
          syncHead();
          fit();
        });
      });

      goBtn.addEventListener('click', onGoClick);
      window.addEventListener('resize', fit);
      inited = true;
    }

    syncHead();
    fit();
  }

  window.HeroInteractive = { init: init, syncHeight: fit };
})();
