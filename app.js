(() => {
  'use strict';
  const DATA = window.APP_DATA || { exams: {}, curricula: {}, dictionarySeed: { oge: [], ege: [] }, counts: { approved: 0 } };
  const PAGE = document.body.dataset.page || 'home';
  const QUERY = new URLSearchParams(window.location.search);
  const EXAM = document.body.dataset.exam === 'ege' || QUERY.get('exam') === 'ege' ? 'ege' : 'oge';
  const CONFIG = DATA.exams[EXAM] || DATA.exams.oge || {};
  const EXAM_LABEL = CONFIG.label || (EXAM === 'ege' ? 'ЕГЭ' : 'ОГЭ');
  const root = document.getElementById('app');
  const memory = { storage: true };
  const STORAGE_KEY = 'english-exam-static-v1';
  const writingPrompts = {
    oge: {
      email: 'You have received an email from your English-speaking friend Sam, who writes: “I have joined a school club. What clubs are popular at your school? What do you like doing after classes? How do you usually spend weekends?” Write an email to Sam. Answer the questions and ask 2–3 questions about Sam’s club.'
    },
    ege: {
      email: 'You have received an email from your English-speaking friend Alex, who writes: “Our town is organising a volunteering week. What kinds of volunteering would be useful for teenagers? Have you ever helped with a community project? What skills can young people develop?” Write an email to Alex. Answer the questions and ask 2–3 questions about the volunteering week.',
      essay: 'You are preparing a project on how teenagers in different countries spend time online. Study the figures: messaging — 42%; watching educational videos — 27%; playing online games — 19%; creating content — 12%. Write 200–250 words. Give a brief overview, select and report 2–3 facts, make one comparison, identify a possible problem and suggest a solution.'
    }
  };
  const speakingPrompts = {
    oge: [
      { title: 'Чтение вслух', text: 'Many teenagers enjoy spending time outdoors. They ride bicycles, play team games and go for walks with friends. Regular physical activity helps people stay healthy and feel more energetic.' },
      { title: 'Тематический монолог', text: 'Talk about your favourite school subject. Say what it is, when you have it, why you like it, how it may be useful in the future, and what subject you would like to study more.' }
    ],
    ege: [
      { title: 'Чтение вслух', text: 'Public libraries are changing as communities adapt to new technology. Many now provide quiet study areas, digital resources and workshops that help visitors develop practical skills.' },
      { title: 'Монолог по проектной теме', text: 'Compare two ways of learning a foreign language: attending a face-to-face class and using an online course. Discuss the advantages of each, explain your preference and give reasons for your choice.' }
    ]
  };
  let recorder = null;
  let stream = null;
  let chunks = [];
  let activeRecording = false;
  let recordingPaused = false;
  let clipBlob = null;
  let clipUrl = '';
  let recordingSeconds = 0;
  let recordingTimer = 0;
  let toastTimer = 0;
  let state = loadState();

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }
  function safeExam(value) { return value === 'ege' ? 'ege' : 'oge'; }
  function href(file, params) {
    const query = new URLSearchParams(params || {}).toString();
    return `./${file}${query ? `?${query}` : ''}`;
  }
  function getAllUnits(exam) {
    return (DATA.curricula[safeExam(exam)] || []).flatMap(section => section.units || []);
  }
  function makeId() {
    return window.crypto && typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() : `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
  function freshState() {
    const seeds = [];
    ['oge', 'ege'].forEach(exam => (DATA.dictionarySeed[exam] || []).forEach((word, index) => seeds.push({ ...word, id: `seed-${exam}-${index + 1}`, exam, favorite: false, intervalDays: 0, addedAt: new Date().toISOString(), nextReviewAt: new Date().toISOString() })));
    return { profile: { displayName: 'Ученик', grade: 'Не указан' }, enabledExams: ['oge', 'ege'], attempts: [], completedUnits: [], errors: [], dictionary: seeds, activities: [], writingDrafts: {}, preferences: { dailyGoalMinutes: 25, analyticsConsent: false } };
  }
  function loadState() {
    const base = freshState();
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (!saved) return base;
      const parsed = JSON.parse(saved);
      memory.storage = true;
      return { ...base, ...parsed, profile: { ...base.profile, ...(parsed.profile || {}) }, preferences: { ...base.preferences, ...(parsed.preferences || {}) }, dictionary: Array.isArray(parsed.dictionary) ? parsed.dictionary : base.dictionary, attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [], errors: Array.isArray(parsed.errors) ? parsed.errors : [], activities: Array.isArray(parsed.activities) ? parsed.activities : [], completedUnits: Array.isArray(parsed.completedUnits) ? parsed.completedUnits : [], writingDrafts: parsed.writingDrafts || {} };
    } catch (_) {
      memory.storage = false;
      return base;
    }
  }
  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      memory.storage = true;
      return true;
    } catch (_) {
      memory.storage = false;
      return false;
    }
  }
  function recordActivity(tasks) {
    if (!tasks) return;
    const date = new Date().toISOString().slice(0, 10);
    const old = state.activities.find(item => item.date === date);
    if (old) old.tasks += tasks;
    else state.activities.push({ date, tasks });
  }
  function setMeta(title, description, noindex) {
    document.title = title;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.content = description;
    let robots = document.querySelector('meta[name="robots"]');
    if (!robots) { robots = document.createElement('meta'); robots.name = 'robots'; document.head.appendChild(robots); }
    robots.content = noindex ? 'noindex,nofollow' : 'index,follow';
  }
  function pageHeader(kicker, title, description, right = '') {
    return `<header class="page-header"><div><p class="eyebrow">${escapeHtml(kicker)}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${right ? `<div class="button-row">${right}</div>` : ''}</header>`;
  }
  function notice(text, kind = '') {
    return `<div class="notice ${kind}"><span class="notice-icon">${kind === 'warning' ? '⚠' : kind === 'success' ? '✓' : 'ⓘ'}</span><span>${text}</span></div>`;
  }
  function button(text, attrs = '', kind = '') { return `<button type="button" class="button ${kind}" ${attrs}>${text}</button>`; }
  function showToast(text) {
    let node = document.querySelector('.toast');
    if (!node) { node = document.createElement('div'); node.className = 'toast'; document.body.appendChild(node); }
    node.textContent = text;
    node.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => node.classList.remove('show'), 2800);
  }
  function setNavigation() {
    const navKey = PAGE === 'overview' ? EXAM : PAGE;
    document.querySelectorAll('[data-nav]').forEach(link => link.classList.toggle('active', link.dataset.nav === navKey || (navKey === 'lesson' && link.dataset.nav === 'program') || (navKey === 'trainer' && link.dataset.nav === 'trainers')));
  }
  function overviewPage(exam) {
    const config = DATA.exams[exam];
    const completed = state.completedUnits.filter(id => id.startsWith(`${exam}-`)).length;
    const units = getAllUnits(exam);
    const attempts = state.attempts.filter(item => item.exam === exam);
    const avg = attempts.length ? Math.round(attempts.reduce((sum, item) => sum + item.scorePercent, 0) / attempts.length) : '—';
    const sections = config.sections.map(section => `<article class="structure-row"><div><strong>${escapeHtml(section.title)}</strong><span>${escapeHtml(section.note)}</span></div><em>№ ${escapeHtml(section.taskRange)} · ${section.points} балл.</em></article>`).join('');
    const cards = config.sections.map(section => `<article class="feature"><span class="feature-ico">${section.id === 'listening' ? '♫' : section.id === 'reading' ? '▤' : section.id === 'writing' ? '✎' : section.id === 'speaking' ? '◉' : 'A'}</span><h3>${escapeHtml(section.title)}</h3><p>${escapeHtml(section.note)}</p></article>`).join('');
    const markup = `<div class="page-stack exam-overview">
      <div class="toolbar"><div class="crumb"><a href="./index.html">Главная</a><span>/</span><b>${escapeHtml(config.label)}</b></div><div class="button-row"><a class="button secondary" href="${href('program.html',{exam})}">Программа ${escapeHtml(config.label)}</a><a class="button" href="${href('exam.html',{exam})}">Короткая практика</a></div></div>
      ${pageHeader(`${config.label} ENGLISH · ${config.year} · ${config.grade}`, `Подготовка к ${config.label}`, config.tagline)}
      <section class="overview-banner ${exam}"><div><span class="badge ${exam === 'oge' ? 'blue' : 'violet'}">Официальная спецификация ${config.year}</span><h2>Отдельное направление подготовки</h2><p>${escapeHtml(config.disclaimer)}</p><div class="button-row" style="margin-top:14px"><a class="button secondary" href="${href('diagnostic.html',{exam})}">Диагностика — закрыта</a><a class="text-link" href="${escapeHtml(config.officialUrl)}" target="_blank" rel="noreferrer">Документы ФИПИ ↗</a></div></div><div class="result-ring">${escapeHtml(avg)}</div></section>
      <section class="stats-grid"><div class="stat-card"><span>Заданий по структуре</span><strong>${config.taskCount}</strong><small>письменная и устная части</small></div><div class="stat-card"><span>Максимум</span><strong>${config.maxPrimaryScore}</strong><small>первичных баллов по спецификации</small></div><div class="stat-card"><span>Время</span><strong>${Math.floor(config.totalMinutes / 60)} ч ${config.totalMinutes % 60} мин</strong><small>письменно ${config.writtenMinutes} · устно ${config.oralMinutes} мин</small></div><div class="stat-card"><span>Одобренные вопросы</span><strong>0</strong><small>банк закрыт до независимой экспертизы</small></div></section>
      <section class="section-block"><div class="section-heading"><div><h2>Разделы экзамена</h2><p>Структурные сведения не заменяют оригинальную спецификацию.</p></div><a class="text-link" href="${escapeHtml(config.officialBundleUrl)}" target="_blank" rel="noreferrer">Комплект ФИПИ ↗</a></div><div class="structure-grid">${sections}</div></section>
      <section class="section-block"><div class="section-heading"><div><h2>Программа ${escapeHtml(config.label)}</h2><p>${completed} из ${units.length} тем отмечено на этом устройстве.</p></div><a class="text-link" href="${href('program.html',{exam})}">Все темы →</a></div><div class="feature-grid">${cards}</div></section>
      ${notice(`<strong>В production нет опубликованных тестовых заданий.</strong> Авторские черновики не включены в этот статический пакет. Короткие практика и диагностика поэтому отключены. Учебные конспекты являются авторскими и не имеют зафиксированной независимой экспертизы.`, 'warning')}
    </div>`;
    setMeta(`Подготовка к ${config.label} по английскому 2027 — English Exam`, `Программа и структура ${config.label} 2027. Авторские тестовые вопросы ждут независимой предметной экспертизы.`, false);
    return markup;
  }
  function homePage() {
    const days = new Set(state.activities.filter(item => item.tasks > 0).map(item => item.date));
    const week = Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setHours(0,0,0,0); date.setDate(date.getDate() - (6 - index)); return date.toISOString().slice(0,10); });
    const done = state.completedUnits.length;
    const nextUnit = ['oge','ege'].flatMap(getAllUnits).find(unit => !state.completedUnits.includes(unit.id));
    const weekdays = week.map(date => `<i class="${days.has(date) ? 'on' : ''}" title="${date}"></i>`).join('');
    const features = [
      ['▤','Программа по шагам','Краткие авторские конспекты; независимая предметная экспертиза не зафиксирована.'],
      ['⚡','Тренажёры','В production нет одобренного банка вопросов. Доступны словарь, письмо и локальная запись голоса.'],
      ['◎','Диагностика','Запуск закрыт до публикации не менее 12 проверенных заданий.'],
      ['✧','ИИ-наставник','Серверный ИИ-провайдер в статической версии отсутствует; ответы не симулируются.']
    ].map(item => `<article class="feature"><span class="feature-ico">${item[0]}</span><h3>${item[1]}</h3><p>${item[2]}</p></article>`).join('');
    const mark = exam => `<article class="exam-card ${exam}" data-watermark="${DATA.exams[exam].label}"><div class="exam-top"><span class="exam-tag"><i></i>${DATA.exams[exam].label} ENGLISH</span><span class="badge">${DATA.exams[exam].grade}</span></div><div><h3>Подготовка к ${DATA.exams[exam].label} по английскому</h3><p>${escapeHtml(DATA.exams[exam].tagline)}</p></div><div class="exam-facts"><span>${DATA.exams[exam].taskCount} заданий в структуре</span><span>${DATA.exams[exam].sections.length} разделов</span></div><ul><li>Отдельная программа и прогресс</li><li>Структура и ссылки на материалы ФИПИ</li><li>Тестовый банк закрыт до экспертизы</li></ul><div class="exam-card-footer"><span class="badge ${exam === 'oge' ? 'blue' : 'violet'}">${DATA.exams[exam].year} · ${DATA.exams[exam].grade}</span><a class="text-link" href="./${exam}.html">Открыть направление →</a></div></article>`;
    setMeta('English Exam — подготовка к ОГЭ и ЕГЭ 2027', 'Отдельные программы и краткие учебные материалы для ОГЭ и ЕГЭ. Тестовые черновики не включены в статический пакет.', false);
    return `<div class="page-stack">
      <section class="hero"><div class="hero-copy"><span class="hero-label"><i></i>ПЛАТФОРМА · 2027</span><h1>Твоя подготовка к <span class="blue">ОГЭ</span> и <span class="violet">ЕГЭ</span> по английскому начинается здесь.</h1><p>Открой отдельную программу, изучай короткие темы и работай с локальными инструментами. Полные варианты и одобренный тестовый банк в пакете отсутствуют.</p><div class="hero-actions"><a class="button" href="./oge.html">Выбрать направление →</a><a class="button secondary" href="./trainers.html?exam=oge">Посмотреть инструменты</a></div><div class="hero-notes"><span><b>✓</b> Только локальные данные</span><span><b>✓</b> Без отправки на сервер</span><span><b>✓</b> ОГЭ и ЕГЭ раздельно</span></div></div><aside class="hero-aside"><div class="aside-head"><span>МОЯ ПОДГОТОВКА</span><span class="status-pill"><i></i>ЛОКАЛЬНО</span></div><div class="aside-title">Привет, ${escapeHtml(state.profile.displayName || 'ученик')} 👋</div><p class="aside-subtitle">Прогресс появляется только после действий, которые ты сам(а) отмечаешь.</p><div class="progress-mini"><span>Отмеченные темы</span><strong>${done}</strong></div><div class="activity-days">${weekdays}</div><div class="progress-mini"><span>Следующая тема</span><strong>${nextUnit ? escapeHtml(nextUnit.title) : 'Все темы отмечены'}</strong></div></aside></section>
      <section class="section-block"><div class="section-heading"><div><h2>Два равноправных направления</h2><p>ОГЭ и ЕГЭ имеют отдельные программы и сохраняют отдельный учебный прогресс.</p></div><span class="equal-note">Одинаковый приоритет</span></div><div class="exam-grid">${mark('oge')}${mark('ege')}</div></section>
      <section class="section-block"><div class="section-heading"><div><h2>Инструменты и ограничения</h2><p>Функции не имитируют отсутствующие интеграции и результаты.</p></div></div><div class="feature-grid">${features}</div></section>
      ${notice('<strong>Это офлайн-статическая версия.</strong> Аккаунты, облачная синхронизация, ИИ-ответы и полные экзаменационные варианты недоступны. Юридические разделы — чек-лист, а не готовая политика.', 'warning')}
    </div>`;
  }
  function programPage() {
    const curriculum = DATA.curricula[EXAM] || [];
    const units = curriculum.flatMap(section => section.units || []);
    const selected = QUERY.get('section') || 'all';
    const completed = state.completedUnits.filter(id => id.startsWith(`${EXAM}-`)).length;
    const progress = units.length ? Math.round(completed / units.length * 100) : 0;
    const links = [['all','Все разделы'], ...curriculum.map(section => [section.id, section.title])].map(([id,label]) => `<a class="tab-button ${selected === id ? 'active' : ''}" href="${href('program.html', id === 'all' ? { exam: EXAM } : { exam: EXAM, section: id })}">${escapeHtml(label)}</a>`).join('');
    const sections = curriculum.filter(section => selected === 'all' || section.id === selected).map(section => {
      const cards = section.units.map((unit,index) => `<a class="unit-card" data-search="${escapeHtml((unit.title + ' ' + unit.objective).toLowerCase())}" href="${href('lesson.html',{exam:EXAM,unit:unit.id})}"><div class="unit-meta"><small>${String(index + 1).padStart(2,'0')} · ${unit.minutes} минут</small><span class="badge ${unit.level === 'продвинутый' ? 'violet' : 'blue'}">${escapeHtml(unit.level)}</span></div><h3>${escapeHtml(unit.title)}</h3><p>${escapeHtml(unit.objective)}</p><span class="text-link">${state.completedUnits.includes(unit.id) ? '✓ Отмечен' : 'Открыть урок →'}</span></a>`).join('');
      return `<section class="section-card program-group" data-group="${section.id}"><div class="section-card-head"><div><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.description)}</p></div><span class="badge">${section.units.length} тем</span></div><div class="unit-grid">${cards}</div></section>`;
    }).join('');
    setMeta(`Программа ${EXAM_LABEL} 2027 по английскому — English Exam`, `Краткие авторские темы для подготовки к ${EXAM_LABEL}; независимая предметная экспертиза не зафиксирована.`, false);
    return `<div class="page-stack"><div class="toolbar"><div class="crumb"><a href="./${EXAM}.html">Подготовка ${EXAM_LABEL}</a><span>/</span><b>Программа</b></div><div class="button-row"><select class="select-control" id="exam-select" aria-label="Выбрать экзамен"><option value="oge" ${EXAM === 'oge' ? 'selected' : ''}>ОГЭ 2027</option><option value="ege" ${EXAM === 'ege' ? 'selected' : ''}>ЕГЭ 2027</option></select><a class="button secondary" href="${href('diagnostic.html',{exam:EXAM})}">Диагностика закрыта</a></div></div>${pageHeader(`${EXAM_LABEL} ENGLISH · УЧЕБНЫЙ МАРШРУТ`,`Программа подготовки к ${EXAM_LABEL}`,`${units.length} кратких авторских тем в шести разделах. Независимая предметная экспертиза не зафиксирована.`)}<section class="surface"><div class="toolbar"><div><strong>Мой прогресс в программе</strong><p class="muted">${completed} из ${units.length} тем · только на этом устройстве</p></div><strong>${progress}%</strong></div><div class="progress-bar"><span style="width:${progress}%"></span></div></section><div class="toolbar"><div class="filter-search"><span>⌕</span><input id="program-search" type="search" placeholder="Найти тему или навык…" aria-label="Поиск по темам"></div><div class="section-nav">${links}</div></div><div class="section-list">${sections || '<div class="empty-state"><h2>Темы не найдены</h2><p>Выбери другой фильтр.</p></div>'}</div>${notice('Краткие авторские конспекты — не полный официальный курс; независимая предметная экспертиза не зафиксирована. Сверяй формат и требования с документами ФИПИ.', 'warning')}</div>`;
  }
  function lessonPage() {
    const unitId = QUERY.get('unit') || '';
    const unit = getAllUnits(EXAM).find(item => item.id === unitId);
    if (!unit) {
      setMeta('Урок не найден — English Exam', 'Выбранная тема не найдена в локальной программе.', true);
      return `<div class="page-stack"><div class="empty-state"><span class="empty-icon">▤</span><h2>Тема не найдена</h2><p>Вернись к программе и выбери урок из списка.</p><a class="button" href="${href('program.html',{exam:EXAM})}">Открыть программу</a></div></div>`;
    }
    const complete = state.completedUnits.includes(unit.id);
    const practice = unit.section === 'grammar' ? 'grammar' : unit.section === 'vocabulary' ? 'vocabulary' : unit.section === 'reading' ? 'reading' : unit.section === 'listening' ? 'listening' : unit.section === 'writing' ? 'writing' : 'speaking';
    setMeta(`${unit.title} — ${EXAM_LABEL} English Exam`, `Краткий авторский урок ${unit.title}; независимая предметная экспертиза не зафиксирована.`, false);
    return `<div class="page-stack"><div class="crumb"><a href="${href('program.html',{exam:EXAM})}">Программа ${EXAM_LABEL}</a><span>/</span><b>${escapeHtml(unit.title)}</b></div>${pageHeader(`${EXAM_LABEL} · ${escapeHtml(unit.section)}`,unit.title,unit.objective,`<span class="badge">${unit.minutes} минут</span>`)}<div class="lesson-layout"><div class="lesson-main"><article class="surface lesson-content"><p class="eyebrow">КОРОТКО О ГЛАВНОМ</p><h2>Теория</h2><div class="lesson-theory">${escapeHtml(unit.theory)}</div><div class="example-box"><b>Пример</b><br>${escapeHtml(unit.example)}</div></article><article class="surface lesson-content"><p class="eyebrow">ЗАКРЕПЛЕНИЕ</p><h2>Практика</h2><p class="muted">В production нет одобренных вопросов по этой теме. Тестовый банк не включён в статический пакет.</p><a class="button secondary" href="${href('trainer.html',{exam:EXAM,id:practice})}">Открыть тренажёр →</a></article><div class="toolbar"><button class="button ${complete ? 'secondary' : ''}" data-action="complete-unit" data-unit="${escapeHtml(unit.id)}">${complete ? '✓ Урок отмечен — отменить' : 'Отметить урок пройденным'}</button><a class="button ghost" href="${href('program.html',{exam:EXAM})}">Назад к программе</a></div></div><aside class="lesson-side"><div class="lesson-side-card"><p class="eyebrow">ЦЕЛЬ</p><h3>${escapeHtml(unit.title)}</h3><p>${escapeHtml(unit.objective)}</p></div><div class="lesson-side-card"><p class="eyebrow">ДАЛЬШЕ</p><p>Отметка сохраняется локально. Облачной синхронизации нет.</p><a href="${href('trainers.html',{exam:EXAM})}">Все инструменты →</a></div></aside></div>${notice('Краткий авторский конспект без зафиксированной независимой предметной экспертизы. Проверяй требования по актуальным документам ФИПИ.', 'warning')}</div>`;
  }
  const trainerList = [
    ['find-error','Найди ошибку','Ищи и исправляй ошибки в предложениях.','банк на экспертизе','⌕'],
    ['dictionary','Умный словарь','Добавляй слова и повторяй их по расписанию.','локально','▣'],
    ['speed','Тренировка на скорость','Короткий раунд на точность и время.','банк на экспертизе','◷'],
    ['streak','Огонёк учёбы','Отмечай реально выполненные занятия.','локально','♨'],
    ['grammar','Грамматический тренажёр','Закрепляй правила в контексте.','банк на экспертизе','A'],
    ['vocabulary','Лексический тренажёр','Практикуй лексику в контексте.','банк на экспертизе','Aa'],
    ['wordformation','Словообразование','Меняй часть речи и форму слова.','банк на экспертизе','✦'],
    ['tenses','Тренажёр времён','Сопоставляй времена и контекст.','банк на экспертизе','◷'],
    ['reading','Тренажёр чтения','Ищи мысль, детали и связи.','банк на экспертизе','▤'],
    ['listening','Тренажёр аудирования','Лицензированных аудиозаписей нет.','банк на экспертизе','♫'],
    ['writing','Тренажёр письма','Считай слова, сохраняй свой черновик.','ИИ-разбор не подключён','✎'],
    ['speaking','Тренажёр говорения','Записывай и скачивай аудио локально.','без автооценки','◉']
  ];
  function trainerHub() {
    const cards = trainerList.map(([id,title,description,status,icon]) => `<a class="tool-card" href="${href('trainer.html',{exam:EXAM,id})}"><div class="tool-card-head"><span class="tool-ico">${icon}</span><span class="badge ${status.includes('экспертизе') ? 'amber' : ''}">${status}</span></div><h3>${title}</h3><p>${description}</p><div class="tool-card-foot"><span>${EXAM_LABEL} · отдельный прогресс</span><span>Открыть →</span></div></a>`).join('');
    setMeta('Тренажёры английского для ОГЭ и ЕГЭ — English Exam', 'Локальные инструменты; одобренный тестовый банк и серверный ИИ не включены.', false);
    return `<div class="page-stack"><div class="toolbar"><div class="crumb"><a href="./index.html">Главная</a><span>/</span><b>Тренажёры</b></div><select class="select-control" id="exam-select" aria-label="Выбрать экзамен"><option value="oge" ${EXAM === 'oge' ? 'selected' : ''}>ОГЭ 2027</option><option value="ege" ${EXAM === 'ege' ? 'selected' : ''}>ЕГЭ 2027</option></select></div>${pageHeader('ПРАКТИКА · 12 ИНСТРУМЕНТОВ','Тренажёры английского',`Выбери доступный инструмент и экзамен. Тестовые задания в production не опубликованы.`)}<div class="notice"><span class="notice-icon">ⓘ</span><span>Для упражнений нужен независимо проверенный банк. Сейчас доступны словарь, локальные заметки, письмо и запись голоса без автоматической оценки.</span></div><div class="cards-grid">${cards}</div></div>`;
  }
  function emptyBank(exam, title = 'Нет одобренных тестовых заданий') {
    return `<div class="empty-state"><span class="empty-icon">▤</span><h2>${title}</h2><p>Банк ${EXAM_LABEL} закрыт до независимой предметной проверки. Авторские черновики не включены в статический пакет.</p><div class="button-row"><a class="button secondary" href="${href('program.html',{exam})}">Открыть программу ${EXAM_LABEL}</a><a class="button ghost" href="${href('trainers.html',{exam})}">Все инструменты</a></div></div>`;
  }
  function trainerPage() {
    const id = QUERY.get('id') || 'grammar';
    const title = (trainerList.find(row => row[0] === id) || [id,'Тренажёр'])[1];
    if (id === 'dictionary') return `${pageHeader(`${EXAM_LABEL} · ЛОКАЛЬНЫЙ ИНСТРУМЕНТ`,title,'Отдельная локальная подборка слов для выбранного экзамена.')}${dictionaryPanel(EXAM)}`;
    if (id === 'writing') return writingTrainer(EXAM);
    if (id === 'speaking') return speakingTrainer(EXAM);
    if (id === 'streak') return streakTrainer(EXAM);
    return `${pageHeader(`${EXAM_LABEL} · ТРЕНАЖЁР`,title,'Тестовый банк отсутствует до независимой предметной экспертизы.')} ${emptyBank(EXAM, 'В production пока нет одобренных заданий')}`;
  }
  function writingTrainer(exam) {
    const task = exam === 'ege' && QUERY.get('task') === 'essay' ? 'essay' : 'email';
    const prompt = writingPrompts[exam][task];
    const key = `${exam}:${task}`;
    const draft = state.writingDrafts[key] || '';
    const count = draft.trim() ? draft.trim().split(/\s+/).filter(Boolean).length : 0;
    const taskTabs = exam === 'ege' ? `<div class="section-nav"><a class="tab-button ${task === 'email' ? 'active' : ''}" href="${href('trainer.html',{exam,id:'writing',task:'email'})}">Задание 37 · письмо</a><a class="tab-button ${task === 'essay' ? 'active' : ''}" href="${href('trainer.html',{exam,id:'writing',task:'essay'})}">Задание 38 · проект</a></div>` : '';
    const target = task === 'email' ? (exam === 'oge' ? '100–120' : '100–140') : '200–250';
    setMeta(`Письменная практика ${EXAM_LABEL} — English Exam`, 'Авторский черновой промпт; серверный ИИ-разбор не настроен.', true);
    return `<div class="page-stack">${pageHeader(`${EXAM_LABEL} · АВТОРСКАЯ ПРАКТИКА`,'Письменное задание','Счётчик слов и локальное сохранение черновика. Автоматическая проверка отключена.')}${taskTabs}<div class="writing-grid"><section class="surface"><p class="eyebrow">ЧЕРНОВОЙ ПРОМПТ · НЕ ПРОШЁЛ НЕЗАВИСИМУЮ ЭКСПЕРТИЗУ</p><div class="writing-prompt">${escapeHtml(prompt)}</div><p class="footer-note">Ориентир по объёму: ${target} слов. Сверь задание и критерии с актуальной спецификацией ФИПИ.</p></section><section class="surface"><div class="toolbar"><h2 style="margin:0;font-size:14px">Твой ответ</h2><span class="word-count" id="word-count">${count} слов</span></div><div class="field" style="margin-top:12px"><textarea id="writing-answer" aria-label="Ответ на письменное задание" placeholder="Напиши ответ на английском…">${escapeHtml(draft)}</textarea></div><div class="button-row" style="margin-top:11px"><button type="button" class="button" data-action="save-writing" data-key="${key}">Сохранить черновик</button><button type="button" class="button secondary" disabled title="Серверный ИИ-провайдер не подключён">ИИ-разбор недоступен</button></div><p class="footer-note" style="margin-top:12px">Текст хранится только в браузере. ИИ-провайдер не настроен, поэтому ответ не отправляется и обратная связь не имитируется.</p></section></div>${notice('Промпт — авторский черновик без зафиксированной независимой предметной экспертизы. Не вводи персональные данные.', 'warning')}</div>`;
  }
  function speakingTrainer(exam) {
    const prompts = speakingPrompts[exam];
    const task = Math.min(prompts.length - 1, Math.max(0, Number(QUERY.get('task') || 0)));
    const prompt = prompts[task];
    const clockText = `00:${String(Math.floor(recordingSeconds/60)).padStart(2,'0')}:${String(recordingSeconds%60).padStart(2,'0')}`;
    const controls = activeRecording
      ? `<button type="button" class="button secondary" data-action="pause-recording">${recordingPaused ? 'Продолжить' : 'Пауза'}</button><button type="button" class="button danger" data-action="stop-recording">Остановить</button>`
      : `<button type="button" class="button" data-action="start-recording">◉ Начать запись</button>`;
    const clipMarkup = clipUrl
      ? `<audio class="audio-player" id="recorded-audio" src="${clipUrl}" controls aria-label="Прослушать запись"></audio><button type="button" class="button secondary" data-action="save-audio">Скачать запись</button><button type="button" class="button ghost" data-action="delete-audio">Удалить</button>`
      : '';
    setMeta(`Говорение ${EXAM_LABEL} — English Exam`, 'Локальная запись доступна при поддержке MediaRecorder; распознавания и оценки речи нет.', true);
    return `<div class="page-stack">${pageHeader(`${EXAM_LABEL} · УСТНАЯ ПРАКТИКА`,'Запись ответа',`Задание ${task + 1} из ${prompts.length}. Промпт — авторский черновик.`)}<section class="speaker-box"><span class="badge ${exam === 'oge' ? 'blue' : 'violet'}">${escapeHtml(prompt.title)}</span><div class="speaker-text">${escapeHtml(prompt.text)}</div><div class="button-row"><a class="button secondary ${task === 0 ? 'hidden' : ''}" href="${href('trainer.html',{exam,id:'speaking',task:task-1})}">← Предыдущее</a><a class="button secondary ${task === prompts.length - 1 ? 'hidden' : ''}" href="${href('trainer.html',{exam,id:'speaking',task:task+1})}">Следующее →</a></div></section><section class="speaker-box"><div class="toolbar"><div><p class="eyebrow">ЗАПИСЬ ГОЛОСА · ТОЛЬКО ЛОКАЛЬНО</p><h2 style="margin:0;font-size:15px" id="record-status">${activeRecording ? (recordingPaused ? 'Запись приостановлена' : 'Идёт запись') : clipUrl ? 'Клип готов к прослушиванию/скачиванию' : 'Готово к записи'}</h2></div><span class="badge" id="record-clock">${clockText}</span></div><div class="speaker-controls">${controls}${clipMarkup}<button type="button" class="button secondary" disabled title="Отправка речи не подключена">Отправить на проверку недоступно</button></div><p class="footer-note" id="record-hint">После остановки можно переслушать и скачать запись. Клип не переживает переход на другую страницу, если его не скачать.</p><p class="status-box hidden" id="record-error" role="alert"></p></section>${notice('Запись не отправляется на сервер. Распознавание речи, оценка произношения и экспертная отправка не подключены. Физический микрофон может быть недоступен в некоторых браузерах при file://.', 'warning')}</div>`;
  }
  function streakTrainer(exam) {
    const today = new Date().toISOString().slice(0,10);
    const existing = state.activities.find(item => item.date === today);
    const days = new Set(state.activities.filter(item => item.tasks > 0).map(item => item.date));
    let streak = 0; let cursor = new Date(); cursor.setHours(0,0,0,0);
    if (!days.has(cursor.toISOString().slice(0,10))) cursor.setDate(cursor.getDate()-1);
    while (days.has(cursor.toISOString().slice(0,10))) { streak++; cursor.setDate(cursor.getDate()-1); }
    return `<div class="page-stack">${pageHeader(`${EXAM_LABEL} · РЕАЛЬНАЯ ЛОКАЛЬНАЯ АКТИВНОСТЬ`,'Огонёк учёбы','Счётчик растёт только после того, как ты сам(а) отметишь фактически завершённое занятие.') }<div class="stats-grid"><div class="stat-card"><span>Текущая серия</span><strong>${streak}</strong><small>дней подряд с отмеченным занятием</small></div><div class="stat-card"><span>Дней активности</span><strong>${days.size}</strong><small>фактические отметки</small></div><div class="stat-card"><span>Сегодня</span><strong>${existing ? 'Есть' : 'Нет'}</strong><small>отметка на этом устройстве</small></div><div class="stat-card"><span>Экзамен</span><strong>${EXAM_LABEL}</strong><small>прогресс локальный</small></div></div><section class="surface"><h2 style="margin:0 0 7px;font-size:14px">Отметить занятие</h2><p class="muted">Нажимай только после реальной учебной работы. Это ручная запись, а не автоматическая оценка.</p><button class="button" data-action="mark-activity" ${existing ? 'disabled' : ''}>${existing ? 'Сегодня уже отмечено' : 'Отметить завершённое занятие'}</button></section></div>`;
  }
  function examPage() {
    const config = DATA.exams[EXAM];
    setMeta(`Короткая практика ${EXAM_LABEL} 2027 — English Exam`, `Полный вариант КИМ ${EXAM_LABEL} в статическом пакете отсутствует.`, true);
    return `<div class="page-stack">${pageHeader(`${EXAM_LABEL} · ЭКЗАМЕНАЦИОННАЯ ПРАКТИКА`,'Короткий тренировочный раунд','Полные официальные варианты в этот статический пакет не включены.') }<section class="overview-banner ${EXAM}"><div><span class="badge">0 одобренных вопросов</span><h2>Раунд недоступен</h2><p>В производственном пакете нет независимо проверенного тестового банка. Старт остаётся отключённым, вместо вопросов-заглушек.</p><div class="button-row" style="margin-top:13px"><button class="button" disabled>Банк на экспертизе</button><a class="button secondary" href="${escapeHtml(config.officialUrl)}" target="_blank" rel="noreferrer">Открыть ФИПИ ↗</a></div></div><div class="result-ring">0</div></section><section class="surface"><p class="eyebrow">ОФИЦИАЛЬНАЯ СТРУКТУРА ${config.year}</p><h2 style="margin:0 0 7px;font-size:16px">${config.taskCount} заданий · ${config.maxPrimaryScore} первичных баллов</h2><p class="muted">Письменная часть ${config.writtenMinutes} мин · устная часть ${config.oralMinutes} мин.</p><div class="structure-grid">${config.sections.map(section => `<article class="structure-row"><div><strong>${escapeHtml(section.title)}</strong><span>${escapeHtml(section.note)}</span></div><em>№ ${escapeHtml(section.taskRange)}</em></article>`).join('')}</div><p class="footer-note" style="margin-top:12px">Статические сведения не заменяют официальную спецификацию. Полных вариантов, аудиофайлов и официальной проверки здесь нет.</p></section></div>`;
  }
  function diagnosticPage() {
    setMeta(`Диагностика ${EXAM_LABEL} — English Exam`, 'Диагностика отключена: в пакете нет 12 экспертно одобренных вопросов.', true);
    return `<div class="page-stack">${pageHeader(`${EXAM_LABEL} · ДИАГНОСТИКА`,'Стартовая диагностика','Оценка не симулируется, пока нет проверенного банка заданий.') }<div class="empty-state"><span class="empty-icon">◎</span><h2>Банк на экспертизе</h2><p>Для запуска требуется не менее 12 опубликованных и независимо проверенных вопросов. Сейчас доступно: 0. Письмо и говорение не оцениваются автоматически.</p><button class="button" disabled>Начать диагностику</button><a class="button secondary" href="${href('program.html',{exam:EXAM})}">Открыть программу</a></div>${notice('Авторские черновые вопросы не включены в статический пакет. Здесь не создаются фиктивные баллы или профиль сильных/слабых навыков.', 'warning')}</div>`;
  }
  function aiPage() {
    const modes = [['teacher','ИИ-учитель'],['examiner','ИИ-экзаменатор'],['coach','ИИ-тренер'],['analyst','Аналитик ошибок'],['writing','Помощник по письму'],['speaking','Помощник по говорению']];
    const chosen = modes.some(item => item[0] === QUERY.get('mode')) ? QUERY.get('mode') : 'teacher';
    const tabs = modes.map(([id,label]) => `<a class="tab-button ${chosen === id ? 'active' : ''}" href="${href('ai.html',{exam:EXAM,mode:id})}">${label}</a>`).join('');
    setMeta('ИИ-наставник — English Exam', 'Серверный ИИ-провайдер не подключён. Ответы не симулируются.', true);
    return `<div class="page-stack">${pageHeader('УЧЕБНЫЙ ИИ · 6 РЕЖИМОВ','ИИ-наставник','Статический сайт не может безопасно хранить серверный ключ провайдера. Реальные AI-ответы не настроены.') }<div class="section-nav">${tabs}</div><section class="surface"><div class="status-box"><strong>Сервис не подключён.</strong> Этот интерфейс не отправляет сообщения и не возвращает canned/сгенерированные ответы.</div><div class="field" style="margin-top:14px"><label for="ai-message">Сообщение</label><textarea id="ai-message" placeholder="ИИ-провайдер не подключён" disabled></textarea></div><div class="button-row" style="margin-top:10px"><button class="button" disabled>Отправить</button><span class="footer-note">Реальный AI требует серверной интеграции с ключом вне клиентского кода.</span></div></section></div>`;
  }
  function dashboardPage() {
    const completed = state.completedUnits.length;
    const activities = state.activities.filter(item => item.tasks > 0);
    const totalTasks = state.attempts.reduce((sum, item) => sum + item.total, 0);
    const percent = totalTasks ? Math.round(state.attempts.reduce((sum,item)=>sum+item.correct,0) / totalTasks * 100) : '—';
    const today = new Date().toISOString().slice(0,10);
    const week = Array.from({length:14},(_,index)=>{const date=new Date();date.setHours(0,0,0,0);date.setDate(date.getDate()-(13-index));return date.toISOString().slice(0,10)});
    const activityMarkup = week.map(date => `<i class="${activities.some(item=>item.date===date)?'on':''}" title="${date}"></i>`).join('');
    setMeta('Мой прогресс — English Exam','Локальная статистика только по фактически сохранённым действиям.',true);
    return `<div class="page-stack">${pageHeader('ЛОКАЛЬНЫЙ ПРОФИЛЬ','Мой прогресс','Данные видны только в этом браузере/профиле и не синхронизируются между устройствами.') }<section class="stats-grid"><div class="stat-card"><span>Отмеченные темы</span><strong>${completed}</strong><small>из 89 авторских тем</small></div><div class="stat-card"><span>Учебные попытки</span><strong>${state.attempts.length}</strong><small>экзаменационных тестов нет</small></div><div class="stat-card"><span>Дней активности</span><strong>${activities.length}</strong><small>фактические отметки</small></div><div class="stat-card"><span>Точность тестов</span><strong>${percent}${percent === '—' ? '' : '%'}</strong><small>без данных не рассчитывается</small></div></section><section class="surface"><div class="section-heading"><div><h2>Последние две недели</h2><p>Метки появляются после завершённых действий.</p></div></div><div class="activity-days">${activityMarkup}</div><p class="footer-note">Сегодня: ${today}. Нет фиктивных баллов, заданий или серий.</p></section><section class="surface"><div class="section-heading"><div><h2>Раздельные направления</h2><p>Каждая отметка урока хранит ID своего экзамена.</p></div></div><div class="button-row"><a class="button secondary" href="./oge.html">ОГЭ: ${state.completedUnits.filter(id=>id.startsWith('oge-')).length} тем</a><a class="button secondary" href="./ege.html">ЕГЭ: ${state.completedUnits.filter(id=>id.startsWith('ege-')).length} тем</a></div></section></div>`;
  }
  function errorsPage() {
    const errors = state.errors || [];
    setMeta('Мои ошибки — English Exam','Ошибки из фактически выполненных локальных попыток.',true);
    return `<div class="page-stack">${pageHeader('ЛОКАЛЬНАЯ ИСТОРИЯ','Мои ошибки','Ошибки появятся только после завершённых проверенных упражнений.')}${errors.length ? `<div class="table-list">${errors.map(item=>`<article class="error-row"><strong>${escapeHtml(item.exam.toUpperCase())} · ${escapeHtml(item.topic || 'Практика')}</strong><p>${escapeHtml(item.prompt)}</p><p class="answer">Твой ответ: ${escapeHtml(item.answer)}</p><p>Верно: ${escapeHtml(item.correctAnswer)}</p><small>${escapeHtml(item.explanation)}</small></article>`).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">⌕</span><h2>Пока нет сохранённых ошибок</h2><p>В этой версии нет одобренного тестового банка, поэтому ошибки и результаты не выдумываются.</p><a class="button secondary" href="./trainers.html?exam=oge">Открыть инструменты</a></div>`}</div>`;
  }
  function dictionaryPanel(exam) {
    const words = (state.dictionary || []).filter(word => word.exam === exam);
    const rows = words.map(word => `<article class="word-row"><div><b>${escapeHtml(word.word)} ${word.favorite ? '★' : ''}</b><small>${escapeHtml(word.transcription || '')} · ${escapeHtml(word.translation)} · ${escapeHtml(word.topic || 'Без категории')}</small><small>${escapeHtml(word.example || '')}</small></div><div class="word-actions"><button type="button" data-action="favorite-word" data-id="${escapeHtml(word.id)}">${word.favorite ? 'Убрать ★' : 'В избранное'}</button><button type="button" data-action="known-word" data-id="${escapeHtml(word.id)}">Знаю</button><button type="button" data-action="delete-word" data-id="${escapeHtml(word.id)}">Удалить</button></div></article>`).join('');
    return `<section class="section-block"><div class="toolbar"><div><h2 style="margin:0;font-size:14px">Слова для ${exam === 'oge' ? 'ОГЭ' : 'ЕГЭ'}</h2><p class="muted">${words.length} слов · хранение локально</p></div></div><form class="inline-form" data-form="add-word"><label class="field"><span>Слово</span><input name="word" required maxlength="100" placeholder="take part"></label><label class="field"><span>Перевод</span><input name="translation" required maxlength="180" placeholder="принимать участие"></label><label class="field"><span>Транскрипция</span><input name="transcription" maxlength="100" placeholder="/teɪk pɑːt/"></label><label class="field"><span>Тема</span><input name="topic" maxlength="80" placeholder="School"></label><label class="field wide"><span>Пример</span><input name="example" maxlength="220" placeholder="Our class will take part in the fair."></label><div class="wide"><button class="button" type="submit">Добавить слово</button></div></form>${rows ? `<div class="word-list">${rows}</div>` : '<div class="empty-state"><h2>Подборка пуста</h2><p>Добавь слово, чтобы создать локальный список.</p></div>'}${notice('Словарь — учебный материал. Озвучивание/перевод не отправляются на сервер; синтез речи зависит от браузера.', '')}</section>`;
  }
  function dictionaryPage() {
    setMeta('Умный словарь — English Exam','Локальные подборки слов отдельно для ОГЭ и ЕГЭ.',true);
    return `<div class="page-stack">${pageHeader('ЛИЧНЫЙ СЛОВАРЬ · РАЗДЕЛЬНЫЕ ПОДБОРКИ','Умный словарь','Добавляй и повторяй слова отдельно для каждого экзамена.')}<div class="toolbar"><span class="muted">Подборка для экзамена</span><select id="exam-select" class="select-control" aria-label="Выбрать экзамен"><option value="oge" ${EXAM === 'oge' ? 'selected' : ''}>ОГЭ</option><option value="ege" ${EXAM === 'ege' ? 'selected' : ''}>ЕГЭ</option></select></div>${dictionaryPanel(EXAM)}</div>`;
  }
  function accountPage() {
    const storage = memory.storage ? 'Локальное хранилище браузера доступно.' : 'Браузер не разрешил localStorage; изменения останутся только до закрытия вкладки.';
    setMeta('Аккаунт и настройки — English Exam','Только локальный гостевой режим; регистрация и облачная синхронизация не настроены.',true);
    return `<div class="page-stack">${pageHeader('ПРОФИЛЬ · ЛОКАЛЬНОЕ ХРАНЕНИЕ','Аккаунт и настройки','Статическая версия не подключает регистрацию, сервер или облачную синхронизацию.') }<div class="account-grid"><section class="surface"><p class="eyebrow">ГОСТЕВОЙ ПРОФИЛЬ</p><div class="field"><label for="profile-name">Имя в интерфейсе</label><input id="profile-name" maxlength="50" value="${escapeHtml(state.profile.displayName)}"></div><div class="field" style="margin-top:10px"><label for="profile-grade">Класс</label><select id="profile-grade"><option ${state.profile.grade==='Не указан'?'selected':''}>Не указан</option><option ${state.profile.grade==='8 класс'?'selected':''}>8 класс</option><option ${state.profile.grade==='9 класс'?'selected':''}>9 класс</option><option ${state.profile.grade==='10 класс'?'selected':''}>10 класс</option><option ${state.profile.grade==='11 класс'?'selected':''}>11 класс</option></select></div><div class="button-row" style="margin-top:12px"><button class="button" data-action="save-profile">Сохранить на этом устройстве</button><button class="button danger" data-action="clear-data">Очистить локальные данные</button></div></section><section class="surface"><p class="eyebrow">ХРАНЕНИЕ И ИНТЕГРАЦИИ</p><div class="status-box">${storage}</div><p class="legal-copy">${state.profile.displayName ? escapeHtml(state.profile.displayName) : 'Гость'} · только этот браузер. Не создавай здесь пароль: серверной учётной записи нет.</p><div class="setting-row"><div><b>Регистрация</b><small>Не поддерживается в статическом пакете</small></div><span class="badge">Отключена</span></div><div class="setting-row"><div><b>Облачный прогресс</b><small>Supabase проект не настроен</small></div><span class="badge">Отключён</span></div><div class="setting-row"><div><b>Необязательная аналитика</b><small>Сторонняя аналитика не подключена</small></div><input type="checkbox" id="analytics-toggle" ${state.preferences.analyticsConsent ? 'checked' : ''} aria-label="Настройка согласия аналитики"></div><p class="footer-note">Переключатель лишь сохраняет локальное предпочтение и не загружает аналитику.</p></section></div>${notice('Не указывай персональные данные. Этот пакет не имеет сервера и не предоставляет юридически проверенную регистрацию или облачное хранение.', 'warning')}</div>`;
  }
  function adminPage() {
    setMeta('Администрирование — English Exam','Серверная панель отсутствует в статической сборке.',true);
    return `<div class="page-stack">${pageHeader('ЗАКРЫТЫЙ РАЗДЕЛ','Панель администратора','Статический сайт не имеет аутентификации, Supabase или редакторского API.') }<div class="empty-state"><span class="empty-icon">◇</span><h2>Административные операции недоступны</h2><p>Здесь нет фиктивной формы публикации и нет обхода проверки ролей. Для управления нужен реальный сервер с безопасной авторизацией.</p><a class="button secondary" href="./index.html">На главную</a></div></div>`;
  }
  function legalPage() {
    const docs = {
      privacy: ['Персональные данные и конфиденциальность','Перед публикацией необходимо указать реального оператора, цели и правовые основания обработки, категории данных, сроки хранения, получателей/обработчиков, права субъекта и трансграничную передачу при её наличии. Этот раздел — чек-лист владельцу, не действующая политика.'],
      cookies: ['Cookie и аналитика','Сторонняя аналитика в статической сборке не подключена. Перед запуском нужно перечислить фактически используемые cookie/идентификаторы, цели, срок, поставщика и способ отзыва согласия.'],
      terms: ['Условия использования','До публичного запуска укажите владельца сервиса, возрастные правила, поддержку, порядок удаления аккаунта, условия внешних интеграций и ограничения учебной обратной связи. Этот экран не является готовыми условиями.'],
      contacts: ['Сведения об операторе','Сведения об операторе намеренно не выдуманы. Заполните реальное наименование, статус, адрес и контакт для обращений; проверьте с профильным российским юристом.']
    };
    const selected = docs[QUERY.get('doc')] ? QUERY.get('doc') : 'privacy';
    const tabs = Object.keys(docs).map(key => `<a class="tab-button ${selected === key ? 'active' : ''}" href="${href('legal.html',{doc:key})}">${docs[key][0]}</a>`).join('');
    setMeta('Юридическая информация — English Exam','Чек-лист владельцу; не действующая политика и не юридическая консультация.',true);
    return `<div class="page-stack">${pageHeader('ЮРИДИЧЕСКИЙ ЧЕК-ЛИСТ · ТРЕБУЮТСЯ ДАННЫЕ ВЛАДЕЛЬЦА',docs[selected][0],'Не размещай как действующий юридический документ до заполнения сведений и правовой проверки.') }<div class="legal-tabs">${tabs}</div><section class="surface"><div class="notice warning"><span class="notice-icon">⚠</span><span><strong>Публикация юридических документов заблокирована.</strong> Данные оператора не выдумываются.</span></div><p class="legal-copy">${escapeHtml(docs[selected][1])}</p><ul class="legal-copy"><li>ФИО / наименование и юридический статус оператора;</li><li>адрес и контакт для обращений;</li><li>цели, основания, состав данных и сроки хранения;</li><li>процессоры и внешние сервисы, включая AI;</li><li>права пользователей, порядок удаления и возрастные/родительские правила;</li><li>проверка применимости 152-ФЗ, локализации и уведомлений с профильным юристом.</li></ul><p class="footer-note">Статическая версия не собирает облачные учётные данные и не отправляет учебные ответы.</p></section><a class="text-link" href="./account.html">Настройки хранения →</a></div>`;
  }

  function render() {
    if (!root) return;
    let markup = '';
    switch (PAGE) {
      case 'home': markup = homePage(); break;
      case 'overview': markup = overviewPage(EXAM); break;
      case 'program': markup = programPage(); break;
      case 'lesson': markup = lessonPage(); break;
      case 'trainers': markup = trainerHub(); break;
      case 'trainer': markup = `<div class="page-stack"><div class="toolbar"><div class="crumb"><a href="./trainers.html?exam=${EXAM}">Тренажёры</a><span>/</span><b>${escapeHtml((trainerList.find(row=>row[0]===QUERY.get('id'))||['','Тренажёр'])[1])}</b></div><select id="exam-select" class="select-control" aria-label="Выбрать экзамен"><option value="oge" ${EXAM==='oge'?'selected':''}>ОГЭ</option><option value="ege" ${EXAM==='ege'?'selected':''}>ЕГЭ</option></select></div>${trainerPage()}</div>`; break;
      case 'exam': markup = examPage(); break;
      case 'diagnostic': markup = diagnosticPage(); break;
      case 'ai': markup = aiPage(); break;
      case 'dashboard': markup = dashboardPage(); break;
      case 'errors': markup = errorsPage(); break;
      case 'dictionary': markup = dictionaryPage(); break;
      case 'account': markup = accountPage(); break;
      case 'admin': markup = adminPage(); break;
      case 'legal': markup = legalPage(); break;
      default: markup = `<div class="empty-state"><h2>Раздел не найден</h2><a class="button" href="./index.html">На главную</a></div>`;
    }
    root.innerHTML = markup;
    setNavigation();
  }
  function completeUnit(id) {
    const index = state.completedUnits.indexOf(id);
    if (index >= 0) state.completedUnits.splice(index, 1);
    else { state.completedUnits.push(id); recordActivity(1); }
    saveState(); render(); showToast(index >= 0 ? 'Отметка снята.' : 'Урок отмечен как завершённый на этом устройстве.');
  }
  function updateProgramSearch(value) {
    const term = value.trim().toLowerCase();
    document.querySelectorAll('.unit-card[data-search]').forEach(card => { card.classList.toggle('hidden', !card.dataset.search.includes(term)); });
    document.querySelectorAll('.program-group').forEach(group => { group.classList.toggle('hidden', !group.querySelector('.unit-card:not(.hidden)')); });
  }
  function dictionaryAction(action, id) {
    const word = state.dictionary.find(item => item.id === id);
    if (!word) return;
    if (action === 'favorite-word') word.favorite = !word.favorite;
    if (action === 'known-word') { word.intervalDays = word.intervalDays === 0 ? 1 : word.intervalDays === 1 ? 3 : word.intervalDays === 3 ? 7 : word.intervalDays * 2; word.nextReviewAt = new Date(Date.now() + word.intervalDays * 86400000).toISOString(); recordActivity(1); }
    if (action === 'delete-word') state.dictionary = state.dictionary.filter(item => item.id !== id);
    saveState(); render(); showToast(action === 'delete-word' ? 'Слово удалено.' : 'Словарь обновлён.');
  }
  function startRecording() {
    const error = document.getElementById('record-error');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof window.MediaRecorder === 'undefined') { if(error){error.textContent='Этот браузер не поддерживает локальную запись на этой странице.';error.classList.remove('hidden');} return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(mediaStream => {
      stream = mediaStream; chunks = []; clipBlob = null; activeRecording = true; recordingPaused = false; recordingSeconds = 0;
      const mimeType = ['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(type => window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(type));
      recorder = mimeType ? new window.MediaRecorder(stream, { mimeType }) : new window.MediaRecorder(stream);
      recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        clipBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (clipUrl) URL.revokeObjectURL(clipUrl);
        clipUrl = clipBlob.size ? URL.createObjectURL(clipBlob) : '';
        activeRecording = false; recordingPaused = false; window.clearInterval(recordingTimer); recordingTimer = 0;
        if (stream) stream.getTracks().forEach(track => track.stop()); stream = null;
        render();
      };
      recorder.start();
      recordingTimer = window.setInterval(() => { recordingSeconds++; const clock = document.getElementById('record-clock'); if (clock) clock.textContent = `00:${String(Math.floor(recordingSeconds/60)).padStart(2,'0')}:${String(recordingSeconds%60).padStart(2,'0')}`; }, 1000);
      render();
    }).catch(errorValue => {
      const node = document.getElementById('record-error');
      if (node) { node.textContent = errorValue && errorValue.message ? errorValue.message : 'Нет доступа к микрофону. Проверь разрешение браузера.'; node.classList.remove('hidden'); }
    });
  }
  function pauseRecording() {
    if (!recorder) return;
    if (recorder.state === 'recording') { recorder.pause(); recordingPaused = true; window.clearInterval(recordingTimer); }
    else if (recorder.state === 'paused') { recorder.resume(); recordingPaused = false; recordingTimer = window.setInterval(() => { recordingSeconds++; const clock=document.getElementById('record-clock'); if(clock) clock.textContent=`00:${String(Math.floor(recordingSeconds/60)).padStart(2,'0')}:${String(recordingSeconds%60).padStart(2,'0')}`; },1000); }
    const btn = document.querySelector('[data-action="pause-recording"]'); if(btn) btn.textContent = recordingPaused ? 'Продолжить' : 'Пауза';
  }
  function stopRecording() { if (recorder && recorder.state !== 'inactive') recorder.stop(); }
  function saveAudio() {
    if (!clipBlob || !clipBlob.size) { showToast('Нет готовой записи.'); return; }
    const anchor = document.createElement('a');
    const objectUrl = URL.createObjectURL(clipBlob);
    anchor.href = objectUrl; anchor.download = `english-exam-${EXAM}-task-${QUERY.get('task') || 0}.${clipBlob.type.includes('mp4') ? 'mp4' : 'webm'}`; anchor.style.display = 'none'; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1200);
    recordActivity(1); saveState(); showToast('Запись скачана на устройство.');
  }
  function clearData() {
    if (!window.confirm('Очистить все локальные отметки, словарь и черновики на этом устройстве?')) return;
    state = freshState(); saveState(); render(); showToast('Локальные данные очищены.');
  }
  document.addEventListener('click', event => {
    const anchor = event.target.closest('a');
    if (anchor && anchor.getAttribute('href') && !anchor.getAttribute('href').startsWith('#') && !anchor.getAttribute('href').startsWith('https://')) {
      if (activeRecording) { event.preventDefault(); showToast('Сначала останови запись; затем перейди по ссылке.'); return; }
    }
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    if (action === 'complete-unit') completeUnit(actionButton.dataset.unit);
    if (['favorite-word','known-word','delete-word'].includes(action)) dictionaryAction(action, actionButton.dataset.id);
    if (action === 'mark-activity') { recordActivity(1); saveState(); render(); showToast('Реальное занятие отмечено.'); }
    if (action === 'save-writing') {
      const textarea = document.getElementById('writing-answer'); const text = textarea ? textarea.value : '';
      if (!text.trim()) { showToast('Сначала напиши ответ.'); return; }
      state.writingDrafts[actionButton.dataset.key] = text; recordActivity(1); saveState(); render(); showToast('Черновик сохранён только в браузере.');
    }
    if (action === 'start-recording') startRecording();
    if (action === 'pause-recording') pauseRecording();
    if (action === 'stop-recording') stopRecording();
    if (action === 'save-audio') saveAudio();
    if (action === 'delete-audio') { if (clipUrl) URL.revokeObjectURL(clipUrl); clipUrl=''; clipBlob=null; render(); showToast('Несохранённый клип удалён.'); }
    if (action === 'save-profile') {
      const name=document.getElementById('profile-name'); const grade=document.getElementById('profile-grade');
      state.profile.displayName = name && name.value.trim() ? name.value.trim().slice(0,50) : 'Ученик';
      state.profile.grade = grade ? grade.value : 'Не указан'; saveState(); render(); showToast('Профиль сохранён локально.');
    }
    if (action === 'clear-data') clearData();
  });
  document.addEventListener('submit', event => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    if (form.dataset.form === 'add-word') {
      const values = Object.fromEntries(new FormData(form).entries());
      if (!String(values.word || '').trim() || !String(values.translation || '').trim()) { showToast('Заполни слово и перевод.'); return; }
      state.dictionary.unshift({ id: makeId(), exam: EXAM, word: String(values.word).trim(), translation: String(values.translation).trim(), transcription: String(values.transcription || '').trim(), example: String(values.example || '').trim(), topic: String(values.topic || '').trim(), favorite: false, intervalDays: 0, addedAt: new Date().toISOString(), nextReviewAt: new Date().toISOString() });
      saveState(); render(); showToast('Слово добавлено в локальный словарь.');
    }
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'program-search') updateProgramSearch(event.target.value);
    if (event.target.id === 'writing-answer') {
      const value = event.target.value.trim(); const count = value ? value.split(/\s+/).filter(Boolean).length : 0;
      const counter = document.getElementById('word-count'); if (counter) counter.textContent = `${count} слов`;
    }
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'exam-select') {
      const exam = safeExam(event.target.value);
      const file = PAGE === 'overview' ? `${exam}.html` : PAGE === 'program' ? 'program.html' : PAGE === 'trainers' ? 'trainers.html' : PAGE === 'trainer' ? 'trainer.html' : PAGE === 'dictionary' ? 'dictionary.html' : PAGE === 'exam' ? 'exam.html' : PAGE === 'diagnostic' ? 'diagnostic.html' : 'program.html';
      const params = PAGE === 'trainer' ? { exam, id: QUERY.get('id') || 'grammar', task: QUERY.get('task') || 0 } : PAGE === 'program' ? { exam, ...(QUERY.get('section') ? { section: QUERY.get('section') } : {}) } : { exam };
      window.location.href = href(file, params);
    }
    if (event.target.id === 'analytics-toggle') { state.preferences.analyticsConsent = event.target.checked; saveState(); showToast('Сохранено только локальное предпочтение; аналитика не подключена.'); }
  });
  const menu = document.querySelector('.menu-toggle');
  const side = document.querySelector('.sidebar');
  const scrim = document.querySelector('.mobile-scrim');
  function closeMenu() { if (side) side.classList.remove('open'); if (menu) menu.setAttribute('aria-expanded','false'); if (scrim) scrim.hidden = true; }
  if (menu) menu.addEventListener('click', () => { const open = !side.classList.contains('open'); side.classList.toggle('open', open); menu.setAttribute('aria-expanded', String(open)); if (scrim) scrim.hidden = !open; });
  if (scrim) scrim.addEventListener('click', closeMenu);
  document.querySelectorAll('.sidebar-nav a').forEach(link => link.addEventListener('click', () => { closeMenu(); }));
  window.addEventListener('beforeunload', () => { if (recorder && recorder.state !== 'inactive') { recorder.ondataavailable=null; recorder.onstop=null; recorder.stop(); } if (stream) stream.getTracks().forEach(track=>track.stop()); if (clipUrl) URL.revokeObjectURL(clipUrl); });
  render();
})();
