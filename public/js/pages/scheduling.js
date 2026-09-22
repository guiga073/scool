// public/js/pages/scheduling.js
// Também expõe openClassFormModal() e openClassDetailModal() globalmente,
// usadas também nas abas de calendário de Alunos e Professores.

window.Pages = window.Pages || {};

function conflictWarningHtml(conflicts) {
  if (!conflicts || conflicts.length === 0) return '';
  return `<div class="alert alert-danger">⚠️ Foram identificados conflitos.
    <div style="margin-top:4px;">${conflicts.map(c => `${escapeHtml(c.student_name)} / ${escapeHtml(c.teacher_name)} às ${formatTime(c.start_time)} em ${formatDate(c.start_time)}`).join('<br>')}</div>
    <div class="text-sm" style="margin-top:6px;">A aula foi salva mesmo assim. Você pode manter como está ou ajustar o horário.</div>
  </div>`;
}

async function openClassFormModal(options, onSaved) {
  options = options || {};
  const existing = options.existing || null;
  const [students, subjects, teachers] = await Promise.all([
    api.get('/api/students'), api.get('/api/subjects'), api.get('/api/teachers'),
  ]);

  const presetDate = options.presetDate || (existing ? parseDbDate(existing.start_time) : new Date());
  const dateStr = `${presetDate.getFullYear()}-${pad2(presetDate.getMonth() + 1)}-${pad2(presetDate.getDate())}`;
  const startTimeStr = existing ? formatTime(existing.start_time) : '15:00';
  const endTimeStr = existing ? formatTime(existing.end_time) : '16:00';

  function teacherOptions(subjectId) {
    let filtered = subjectId ? teachers.filter(t => t.subjects.some(s => String(s.id) === String(subjectId))) : teachers;
    // Se o professor já atribuído a esta aula não leciona mais essa disciplina (mudou depois),
    // mantém ele na lista mesmo assim para não trocar o professor da aula sem querer.
    if (existing && !filtered.some(t => t.id === existing.teacher_id)) {
      const current = teachers.find(t => t.id === existing.teacher_id);
      if (current) filtered = [current, ...filtered];
    }
    if (filtered.length === 0) return `<option value="">Nenhum professor cadastrado nesta disciplina</option>`;
    return filtered.map(t => `<option value="${t.id}" ${existing && existing.teacher_id === t.id ? 'selected' : ''} ${options.presetTeacherId == t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('');
  }

  const html = `
    <div class="modal-header"><h3>${existing ? 'Editar aula' : 'Agendar aula'}</h3>
      <button class="modal-close" id="cf-close">&times;</button></div>
    <form id="class-form">
      <div class="field"><label for="cf-student">Aluno</label>
        <select id="cf-student" required>
          <option value="">Selecione…</option>
          ${students.map(s => `<option value="${s.id}" ${(existing && existing.student_id === s.id) || options.presetStudentId == s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
        </select>
        ${students.length === 0 ? '<div class="hint">Cadastre um aluno antes de agendar uma aula.</div>' : ''}
      </div>
      <div class="field"><label for="cf-modality">Modalidade</label>
        <select id="cf-modality">
          <option value="presencial" ${existing && existing.modality === 'presencial' ? 'selected' : ''}>Presencial</option>
          <option value="online" ${existing && existing.modality === 'online' ? 'selected' : ''}>Online</option>
        </select>
      </div>
      <div class="field hidden" id="cf-address-wrap">
        <label>Endereço da aula</label>
        <div class="alert alert-info" id="cf-address-display" style="margin-bottom:0;"></div>
      </div>
      <div class="field"><label for="cf-subject">Disciplina</label>
        <select id="cf-subject" required>
          <option value="">Selecione…</option>
          ${subjects.map(s => `<option value="${s.id}" ${existing && existing.subject_id === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label for="cf-teacher">Professor</label>
        <select id="cf-teacher" required>${teacherOptions(existing ? existing.subject_id : '')}</select>
      </div>

      ${!existing ? `
      <div class="field">
        <div class="checkbox-row"><input type="checkbox" id="cf-recurring"><label for="cf-recurring">Aula de acompanhamento (repetir semanalmente)</label></div>
      </div>` : ''}

      <div id="cf-single-date" class="field-row">
        <div class="field"><label for="cf-date">Data</label><input type="date" id="cf-date" value="${dateStr}" required></div>
        <div class="field"><label for="cf-start">Início</label><input type="time" id="cf-start" value="${startTimeStr}" required></div>
        <div class="field"><label for="cf-end">Término</label><input type="time" id="cf-end" value="${endTimeStr}" required></div>
      </div>

      <div id="cf-recurring-date" class="hidden">
        <div class="field"><label for="cf-weekday">Dia da semana</label>
          <select id="cf-weekday">${WEEKDAY_NAMES.map((n, i) => `<option value="${i}" ${presetDate.getDay() === i ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </div>
        <div class="field-row">
          <div class="field"><label for="cf-start-r">Início</label><input type="time" id="cf-start-r" value="${startTimeStr}" required></div>
          <div class="field"><label for="cf-end-r">Término</label><input type="time" id="cf-end-r" value="${endTimeStr}" required></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="cf-date-from">De</label><input type="date" id="cf-date-from" value="${dateStr}"></div>
          <div class="field"><label for="cf-date-to">Até</label><input type="date" id="cf-date-to"></div>
        </div>
        <div class="hint">Uma aula será criada para cada ocorrência semanal nesse período — cada uma fica registrada separadamente e pode ser editada ou cancelada de forma individual depois.</div>
      </div>

      <div class="field-row">
        <div class="field"><label for="cf-student-value">Valor que o aluno paga (R$)</label><input type="number" step="0.01" min="0" id="cf-student-value" value="${existing ? existing.student_value : ''}" required></div>
        <div class="field"><label for="cf-teacher-value">Valor pago ao professor (R$)</label><input type="number" step="0.01" min="0" id="cf-teacher-value" value="${existing ? existing.teacher_value : ''}" required></div>
      </div>
      <div class="field"><label for="cf-link">Link da aula (Google Meet ou outra plataforma)</label>
        <input type="text" id="cf-link" placeholder="https://meet.google.com/…" value="${escapeHtml(existing && existing.meeting_link || '')}"></div>

      <div id="cf-conflict-area"></div>
      <div id="cf-error" class="alert alert-danger hidden"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" id="cf-cancel">Cancelar</button>
        <button type="submit" class="btn btn-primary">${existing ? 'Salvar alterações' : 'Agendar aula'}</button>
      </div>
    </form>
  `;

  const backdrop = openModal(html, { wide: true });
  backdrop.querySelector('#cf-close').onclick = closeModal;
  backdrop.querySelector('#cf-cancel').onclick = closeModal;

  const subjectSelect = backdrop.querySelector('#cf-subject');
  subjectSelect.addEventListener('change', () => {
    backdrop.querySelector('#cf-teacher').innerHTML = teacherOptions(subjectSelect.value);
  });

  const studentSelect = backdrop.querySelector('#cf-student');
  const modalitySelect = backdrop.querySelector('#cf-modality');
  const addressWrap = backdrop.querySelector('#cf-address-wrap');
  const addressDisplay = backdrop.querySelector('#cf-address-display');
  function updateAddressDisplay() {
    const isPresencial = modalitySelect.value === 'presencial';
    addressWrap.classList.toggle('hidden', !isPresencial);
    if (!isPresencial) return;
    const student = students.find(s => String(s.id) === studentSelect.value);
    if (!student) { addressDisplay.textContent = 'Selecione o aluno para ver o endereço cadastrado dele.'; return; }
    addressDisplay.textContent = student.address ? student.address : `${student.name} não tem endereço cadastrado — adicione em Alunos para que apareça aqui.`;
  }
  studentSelect.addEventListener('change', updateAddressDisplay);
  modalitySelect.addEventListener('change', updateAddressDisplay);
  updateAddressDisplay();

  const recurringCheckbox = backdrop.querySelector('#cf-recurring');
  if (recurringCheckbox) {
    recurringCheckbox.addEventListener('change', () => {
      backdrop.querySelector('#cf-single-date').classList.toggle('hidden', recurringCheckbox.checked);
      backdrop.querySelector('#cf-recurring-date').classList.toggle('hidden', !recurringCheckbox.checked);
    });
  }

  backdrop.querySelector('#class-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = backdrop.querySelector('#cf-error');
    errEl.classList.add('hidden');
    backdrop.querySelector('#cf-conflict-area').innerHTML = '';

    const isRecurring = recurringCheckbox && recurringCheckbox.checked;
    const base = {
      student_id: Number(backdrop.querySelector('#cf-student').value),
      teacher_id: Number(backdrop.querySelector('#cf-teacher').value),
      subject_id: Number(backdrop.querySelector('#cf-subject').value),
      modality: backdrop.querySelector('#cf-modality').value,
      student_value: Number(backdrop.querySelector('#cf-student-value').value),
      teacher_value: Number(backdrop.querySelector('#cf-teacher-value').value),
      meeting_link: backdrop.querySelector('#cf-link').value.trim(),
    };

    try {
      if (isRecurring) {
        const dateTo = backdrop.querySelector('#cf-date-to').value;
        if (!dateTo) throw new Error('Informe a data final da recorrência');
        const payload = {
          ...base,
          day_of_week: Number(backdrop.querySelector('#cf-weekday').value),
          start_time: backdrop.querySelector('#cf-start-r').value,
          end_time: backdrop.querySelector('#cf-end-r').value,
          start_date: backdrop.querySelector('#cf-date-from').value,
          end_date: dateTo,
        };
        const resp = await api.post('/api/classes/recurring', payload);
        closeModal();
        showToast(`${resp.createdCount} aula(s) agendada(s).`);
        if (resp.conflicts.length > 0) {
          showToast(`Atenção: conflitos em ${resp.conflicts.length} data(s). Confira a agenda.`, 'error');
        }
        onSaved();
      } else {
        const d = backdrop.querySelector('#cf-date').value;
        const start = `${d} ${backdrop.querySelector('#cf-start').value}:00`;
        const end = `${d} ${backdrop.querySelector('#cf-end').value}:00`;
        const payload = { ...base, start_time: start, end_time: end };
        const resp = existing
          ? await api.put(`/api/classes/${existing.id}`, payload)
          : await api.post('/api/classes', payload);
        if (resp.conflicts && resp.conflicts.length > 0) {
          backdrop.querySelector('#cf-conflict-area').innerHTML = conflictWarningHtml(resp.conflicts);
          showToast('Aula salva, mas há conflito de horário.', 'error');
          onSaved();
          return;
        }
        closeModal();
        showToast(existing ? 'Aula atualizada.' : 'Aula agendada.');
        onSaved();
      }
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });
}

async function openClassDetailModal(cls, onChanged) {
  const html = `
    <div class="modal-header"><h3>${escapeHtml(cls.subject_name)}</h3><button class="modal-close" id="cd-close">&times;</button></div>
    <p class="muted text-sm">${formatDate(cls.start_time)} · ${formatTime(cls.start_time)}–${formatTime(cls.end_time)}</p>
    <div class="field-row" style="margin-top:14px;">
      <div><div class="text-sm muted">Aluno</div><p><a href="#/alunos/${cls.student_id}">${escapeHtml(cls.student_name)}</a></p></div>
      <div><div class="text-sm muted">Professor</div><p><a href="#/professores/${cls.teacher_id}">${escapeHtml(cls.teacher_name)}</a></p></div>
    </div>
    <div class="field-row">
      <div><div class="text-sm muted">Modalidade</div><p>${cls.modality === 'online' ? 'Online' : 'Presencial'}</p></div>
      ${cls.modality === 'presencial'
        ? `<div><div class="text-sm muted">Endereço</div><p>${cls.student_address ? escapeHtml(cls.student_address) : '<span class="muted">Aluno sem endereço cadastrado</span>'}</p></div>`
        : `<div><div class="text-sm muted">Link</div><p>${cls.meeting_link ? `<a href="${escapeHtml(cls.meeting_link)}" target="_blank" rel="noopener">Abrir link</a>` : '—'}</p></div>`}
    </div>
    <div class="field-row">
      <div><div class="text-sm muted">Aluno paga</div><p class="tabular">${formatCurrency(cls.student_value)} ${cls.student_paid ? '<span class="badge badge-confirmed">Recebido</span>' : '<span class="badge badge-pending">Pendente</span>'}</p></div>
      <div><div class="text-sm muted">Professor recebe</div><p class="tabular">${formatCurrency(cls.teacher_value)}</p></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-danger" id="cd-cancel-class">Cancelar aula</button>
      <button class="btn btn-outline" id="cd-edit">Editar</button>
    </div>
  `;
  const backdrop = openModal(html);
  backdrop.querySelector('#cd-close').onclick = closeModal;
  backdrop.querySelector('#cd-edit').onclick = () => {
    closeModal();
    openClassFormModal({ existing: cls }, onChanged);
  };
  backdrop.querySelector('#cd-cancel-class').onclick = async () => {
    const ok = await confirmModal('Cancelar esta aula? Ela será removida do calendário, dos pagamentos e de todos os cálculos. Essa ação não pode ser desfeita.', 'Cancelar aula');
    if (!ok) return;
    await api.delete(`/api/classes/${cls.id}`);
    closeModal();
    showToast('Aula cancelada.');
    onChanged();
  };
}

Pages.scheduling = async function (root) {
  root.innerHTML = `
    <div class="page-header">
      <div><div class="eyebrow">Agendamento</div><h1>Agenda de aulas</h1>
        <p class="subtitle">Agende, edite e cancele aulas. Conflitos de horário são avisados, mas nunca bloqueiam o agendamento.</p></div>
      <button class="btn btn-accent" id="new-class-btn">+ Agendar aula</button>
    </div>
    <div class="tabs">
      <button class="tab-btn active" data-mode="calendario">Calendário</button>
      <button class="tab-btn" data-mode="busca">Buscar aulas</button>
    </div>
    <div class="card" id="scheduling-body"></div>
  `;

  document.getElementById('new-class-btn').addEventListener('click', () => {
    openClassFormModal({}, () => renderMode(currentMode));
  });

  let currentMode = 'calendario';
  root.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMode = btn.dataset.mode;
      renderMode(currentMode);
    });
  });

  function renderMode(mode) {
    const body = document.getElementById('scheduling-body');
    if (mode === 'calendario') {
      body.innerHTML = `<div id="sched-cal"></div>`;
      Calendar.mount(document.getElementById('sched-cal'), { view: 'month', refDate: new Date() }, {
        fetchClasses: async (start, end) => api.get(`/api/classes?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
        onSelectClass: (cls) => openClassDetailModal(cls, () => renderMode('calendario')),
        onCreateAt: (date) => openClassFormModal({ presetDate: date }, () => renderMode('calendario')),
      });
    } else {
      body.innerHTML = `
        <input type="text" class="search-input" id="class-search" placeholder="Buscar por aluno, professor ou disciplina…">
        <div id="search-results" style="margin-top:16px;"></div>
      `;
      const input = document.getElementById('class-search');
      let debounce;
      const runSearch = async () => {
        const results = await api.get(`/api/classes${input.value ? '?search=' + encodeURIComponent(input.value) : ''}`);
        results.sort((a, b) => a.start_time.localeCompare(b.start_time));
        const resultsEl = document.getElementById('search-results');
        if (results.length === 0) {
          resultsEl.innerHTML = `<div class="empty-state">Nenhuma aula encontrada.</div>`;
          return;
        }
        resultsEl.innerHTML = `<div class="time-slot-list">${results.map(c => `
          <div class="slot" data-id="${c.id}">
            <span class="time">${formatDate(c.start_time)}<br>${formatTime(c.start_time)}</span>
            <span class="grow">${escapeHtml(c.student_name)} · ${escapeHtml(c.subject_name)} <span class="muted">com ${escapeHtml(c.teacher_name)}</span></span>
            <span class="badge badge-neutral">${c.modality === 'online' ? 'Online' : 'Presencial'}</span>
          </div>`).join('')}</div>`;
        resultsEl.querySelectorAll('.slot').forEach(el => {
          el.addEventListener('click', () => {
            const cls = results.find(c => String(c.id) === el.dataset.id);
            openClassDetailModal(cls, runSearch);
          });
        });
      };
      input.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(runSearch, 250); });
      runSearch();
    }
  }
  renderMode(currentMode);
};
