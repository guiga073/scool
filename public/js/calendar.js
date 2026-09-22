// public/js/calendar.js
// Componente de calendário/agenda (dia, semana, mês, ano) — sem dependências externas.

const CalendarMath = {
  startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); },
  endOfMonth(date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0); },

  // Grade do mês: sempre começa no domingo da semana que contém o dia 1,
  // e termina no sábado da semana que contém o último dia do mês.
  monthGridDays(date) {
    const first = CalendarMath.startOfMonth(date);
    const last = CalendarMath.endOfMonth(date);
    const start = new Date(first);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(last);
    end.setDate(end.getDate() + (6 - end.getDay()));
    const days = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  },

  startOfWeek(date) {
    const d = new Date(date);
    d.setDate(d.getDate() - d.getDay());
    return d;
  },

  weekDays(date) {
    const start = CalendarMath.startOfWeek(date);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  },

  sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); },

  addMonths(date, n) { return new Date(date.getFullYear(), date.getMonth() + n, 1); },
  addWeeks(date, n) { const d = new Date(date); d.setDate(d.getDate() + n * 7); return d; },
  addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; },
  addYears(date, n) { return new Date(date.getFullYear() + n, date.getMonth(), date.getDate()); },
};

const Calendar = {
  // container: elemento DOM. options: { view, refDate, onNavigate(view, refDate), onSelectClass(cls), onCreateAt(date) }
  renderToolbar(container, state, onChange) {
    const { view, refDate } = state;
    let label = '';
    if (view === 'month') label = `${MONTH_NAMES[refDate.getMonth()]} de ${refDate.getFullYear()}`;
    else if (view === 'year') label = `${refDate.getFullYear()}`;
    else if (view === 'week') {
      const days = CalendarMath.weekDays(refDate);
      label = `${days[0].getDate()} — ${days[6].getDate()} de ${MONTH_NAMES[days[6].getMonth()]}`;
    } else label = `${refDate.getDate()} de ${MONTH_NAMES[refDate.getMonth()]}, ${refDate.getFullYear()}`;

    const toolbar = document.createElement('div');
    toolbar.className = 'calendar-toolbar';
    toolbar.innerHTML = `
      <div class="calendar-nav">
        <button class="btn btn-outline btn-sm" data-nav="prev">&larr;</button>
        <button class="btn btn-outline btn-sm" data-nav="today">Hoje</button>
        <button class="btn btn-outline btn-sm" data-nav="next">&rarr;</button>
        <span class="label">${label}</span>
      </div>
      <div class="view-switch">
        ${['day', 'week', 'month', 'year'].map(v => `<button data-view="${v}" class="${v === view ? 'active' : ''}">${{ day: 'Dia', week: 'Semana', month: 'Mês', year: 'Ano' }[v]}</button>`).join('')}
      </div>
    `;
    toolbar.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => onChange({ ...state, view: btn.dataset.view }));
    });
    toolbar.querySelector('[data-nav="prev"]').addEventListener('click', () => onChange({ ...state, refDate: Calendar._step(view, refDate, -1) }));
    toolbar.querySelector('[data-nav="next"]').addEventListener('click', () => onChange({ ...state, refDate: Calendar._step(view, refDate, 1) }));
    toolbar.querySelector('[data-nav="today"]').addEventListener('click', () => onChange({ ...state, refDate: new Date() }));
    container.appendChild(toolbar);
  },

  _step(view, refDate, dir) {
    if (view === 'month') return CalendarMath.addMonths(refDate, dir);
    if (view === 'week') return CalendarMath.addWeeks(refDate, dir);
    if (view === 'year') return CalendarMath.addYears(refDate, dir);
    return CalendarMath.addDays(refDate, dir);
  },

  // Intervalo de datas (strings 'YYYY-MM-DD HH:MM:SS') que a view atual precisa buscar da API.
  rangeFor(view, refDate) {
    let start, end;
    if (view === 'month') { const days = CalendarMath.monthGridDays(refDate); start = days[0]; end = days[days.length - 1]; }
    else if (view === 'week') { const days = CalendarMath.weekDays(refDate); start = days[0]; end = days[6]; }
    else if (view === 'year') { start = new Date(refDate.getFullYear(), 0, 1); end = new Date(refDate.getFullYear(), 11, 31); }
    else { start = refDate; end = refDate; }
    const fmt = (d, h) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${h}`;
    return { start: fmt(start, '00:00:00'), end: fmt(end, '23:59:59') };
  },

  renderBody(container, state, classes, onSelectClass, onCreateAt) {
    const { view, refDate } = state;
    const body = document.createElement('div');

    if (view === 'month') {
      const days = CalendarMath.monthGridDays(refDate);
      const grid = document.createElement('div');
      grid.className = 'month-grid';
      WEEKDAY_NAMES.forEach(n => { const el = document.createElement('div'); el.className = 'dow'; el.textContent = n.slice(0, 3); grid.appendChild(el); });
      const today = new Date();
      days.forEach(day => {
        const dayClasses = classes.filter(c => CalendarMath.sameDay(parseDbDate(c.start_time), day));
        const cell = document.createElement('div');
        cell.className = 'month-cell' + (day.getMonth() !== refDate.getMonth() ? ' out' : '') + (CalendarMath.sameDay(day, today) ? ' today' : '');
        const shown = dayClasses.slice(0, 3);
        cell.innerHTML = `<span class="day-num">${day.getDate()}</span>` +
          shown.map(c => `<span class="chip">${formatTime(c.start_time)} ${escapeHtml(c.student_name)}</span>`).join('') +
          (dayClasses.length > 3 ? `<span class="more">+${dayClasses.length - 3} mais</span>` : '');
        cell.addEventListener('click', (e) => {
          if (dayClasses.length === 0) { if (onCreateAt) onCreateAt(day); return; }
          Calendar._openDayList(day, dayClasses, onSelectClass, onCreateAt);
        });
        grid.appendChild(cell);
      });
      body.appendChild(grid);
    } else if (view === 'week' || view === 'day') {
      const days = view === 'week' ? CalendarMath.weekDays(refDate) : [refDate];
      days.forEach(day => {
        const dayClasses = classes.filter(c => CalendarMath.sameDay(parseDbDate(c.start_time), day))
          .sort((a, b) => a.start_time.localeCompare(b.start_time));
        const section = document.createElement('div');
        const title = document.createElement('div');
        title.className = 'day-section-title';
        title.textContent = `${WEEKDAY_NAMES[day.getDay()]}, ${day.getDate()} de ${MONTH_NAMES[day.getMonth()]}`;
        section.appendChild(title);
        const list = document.createElement('div');
        list.className = 'time-slot-list';
        if (dayClasses.length === 0) {
          list.innerHTML = `<div class="muted text-sm" style="padding:6px 2px;">Sem aulas</div>`;
        } else {
          dayClasses.forEach(c => {
            const slot = document.createElement('div');
            slot.className = 'slot';
            slot.innerHTML = `<span class="time">${formatTime(c.start_time)}–${formatTime(c.end_time)}</span>
              <span class="grow">${escapeHtml(c.student_name)} · ${escapeHtml(c.subject_name)} <span class="muted">com ${escapeHtml(c.teacher_name)}</span>
              ${c.modality === 'presencial' ? `<br><span class="text-sm muted">📍 ${c.student_address ? escapeHtml(c.student_address) : 'endereço não cadastrado'}</span>` : ''}</span>
              <span class="badge badge-neutral">${c.modality === 'online' ? 'Online' : 'Presencial'}</span>`;
            slot.addEventListener('click', () => onSelectClass(c));
            list.appendChild(slot);
          });
        }
        section.appendChild(list);
        if (onCreateAt) {
          const addBtn = document.createElement('button');
          addBtn.className = 'btn btn-text btn-sm';
          addBtn.textContent = '+ Agendar aula neste dia';
          addBtn.addEventListener('click', () => onCreateAt(day));
          section.appendChild(addBtn);
        }
        body.appendChild(section);
      });
    } else if (view === 'year') {
      const grid = document.createElement('div');
      grid.className = 'year-grid';
      for (let m = 0; m < 12; m++) {
        const count = classes.filter(c => parseDbDate(c.start_time).getMonth() === m).length;
        const card = document.createElement('div');
        card.className = 'year-month-card';
        card.innerHTML = `<div class="m-name">${MONTH_NAMES[m]}</div><div class="m-count">${count} aula${count === 1 ? '' : 's'}</div>`;
        card.addEventListener('click', () => Calendar._jumpToMonth(refDate.getFullYear(), m));
        grid.appendChild(card);
      }
      body.appendChild(grid);
    }
    container.appendChild(body);
  },

  _jumpToMonth(year, month) {
    if (Calendar._onExternalNav) Calendar._onExternalNav({ view: 'month', refDate: new Date(year, month, 1) });
  },

  _openDayList(day, dayClasses, onSelectClass, onCreateAt) {
    const list = dayClasses.slice().sort((a, b) => a.start_time.localeCompare(b.start_time));
    const html = `
      <div class="modal-header"><h3>${WEEKDAY_NAMES[day.getDay()]}, ${day.getDate()} de ${MONTH_NAMES[day.getMonth()]}</h3>
        <button class="modal-close" id="dl-close">&times;</button></div>
      <div class="time-slot-list">
        ${list.map(c => `<div class="slot" data-id="${c.id}">
            <span class="time">${formatTime(c.start_time)}–${formatTime(c.end_time)}</span>
            <span class="grow">${escapeHtml(c.student_name)} · ${escapeHtml(c.subject_name)} <span class="muted">com ${escapeHtml(c.teacher_name)}</span></span>
          </div>`).join('')}
      </div>
      ${onCreateAt ? `<div class="form-actions"><button class="btn btn-accent" id="dl-add">+ Agendar aula neste dia</button></div>` : ''}
    `;
    const backdrop = openModal(html);
    backdrop.querySelector('#dl-close').onclick = closeModal;
    if (onCreateAt) {
      backdrop.querySelector('#dl-add').onclick = () => { closeModal(); onCreateAt(day); };
    }
    backdrop.querySelectorAll('.slot').forEach(el => {
      el.addEventListener('click', () => {
        const cls = list.find(c => String(c.id) === el.dataset.id);
        closeModal();
        onSelectClass(cls);
      });
    });
  },

  // Ponto de entrada principal.
  mount(container, initialState, callbacks) {
    let state = initialState;
    Calendar._onExternalNav = (s) => { state = s; renderAll(); };

    async function renderAll() {
      container.innerHTML = '';
      Calendar.renderToolbar(container, state, (newState) => { state = newState; renderAll(); });
      const wrap = document.createElement('div');
      wrap.className = 'loading-dots';
      wrap.textContent = 'Carregando aulas…';
      container.appendChild(wrap);
      const { start, end } = Calendar.rangeFor(state.view, state.refDate);
      const classes = await callbacks.fetchClasses(start, end);
      wrap.remove();
      Calendar.renderBody(container, state, classes, callbacks.onSelectClass, callbacks.onCreateAt);
    }
    renderAll();
    return { refresh: renderAll, getState: () => state };
  },
};
