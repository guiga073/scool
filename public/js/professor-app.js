// public/js/professor-app.js

let currentTeacher = null;

async function initProfessorApp() {
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api.post('/api/auth/logout');
    window.location.href = '/login.html';
  });

  let me;
  try {
    const meResp = await api.get('/api/auth/me');
    if (!meResp.user) { window.location.href = '/login.html'; return; }
    if (meResp.user.type === 'admin') { window.location.href = '/'; return; }
    me = meResp.user;
  } catch (e) {
    window.location.href = '/login.html';
    return;
  }

  currentTeacher = await api.get('/api/teacher-portal/me');
  renderShell();
}

function renderShell() {
  const root = document.getElementById('page-root');
  root.innerHTML = `
    <div class="page-header">
      <div><div class="eyebrow">Bem-vindo(a)</div><h1>${escapeHtml(currentTeacher.name)}</h1>
        <p class="subtitle">${currentTeacher.subjects.map(s => escapeHtml(s.name)).join(', ') || 'Nenhuma disciplina cadastrada'}</p></div>
    </div>
    <div class="tabs">
      <button class="tab-btn active" data-tab="ganhos">Meus ganhos</button>
      <button class="tab-btn" data-tab="alunos">Alunos</button>
      <button class="tab-btn" data-tab="aulas">Minhas aulas</button>
      <button class="tab-btn" data-tab="disponibilidade">Minha disponibilidade</button>
    </div>
    <div id="tab-content"></div>
  `;
  let activeTab = 'ganhos';
  root.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      renderTab();
    });
  });
  function renderTab() {
    const el = document.getElementById('tab-content');
    if (activeTab === 'ganhos') renderGanhos(el);
    else if (activeTab === 'alunos') renderAlunos(el);
    else if (activeTab === 'aulas') renderAulas(el);
    else if (activeTab === 'disponibilidade') renderDisponibilidade(el);
  }
  renderTab();
}

async function renderAlunos(el) {
  el.innerHTML = '<div class="loading-dots">Carregando…</div>';
  const classes = await api.get('/api/teacher-portal/classes');
  const map = new Map();
  for (const c of classes) if (!map.has(c.student_id)) map.set(c.student_id, { id: c.student_id, name: c.student_name });
  const students = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  el.innerHTML = `<div class="card"><div id="alunos-panel"></div></div>`;
  FeedbackPanel.renderStudentList(
    document.getElementById('alunos-panel'),
    students,
    (studentId) => `/api/teacher-portal/students/${studentId}`
  );
}

async function renderGanhos(el) {
  el.innerHTML = '<div class="loading-dots">Carregando…</div>';
  const { currentPeriods, invoices } = await api.get('/api/teacher-portal/earnings');
  const { first, second } = currentPeriods;
  el.innerHTML = `
    <p class="text-sm muted">O valor da quinzena atual atualiza sozinho conforme novas aulas são agendadas para você. Quando a quinzena termina, ela vira uma fatura na lista abaixo.</p>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">1ª quinzena (dia 1 a 15) — em andamento</div>
        <div class="stat-value accent tabular">${formatCurrency(first.totalValue)}</div>
        <div class="text-sm muted">${first.totalHours}h dadas até agora</div></div>
      <div class="stat-card"><div class="stat-label">2ª quinzena (dia 16 ao fim do mês) — em andamento</div>
        <div class="stat-value accent tabular">${formatCurrency(second.totalValue)}</div>
        <div class="text-sm muted">${second.totalHours}h dadas até agora</div></div>
    </div>
    <div class="card">
      <div class="card-header"><h2>Faturas quinzenais</h2></div>
      ${invoices.length === 0 ? `<div class="empty-state">Nenhuma fatura gerada ainda.</div>` : `
      <div class="table-wrap"><table>
        <thead><tr><th>Período</th><th class="num">Horas</th><th class="num">Valor</th><th>Status</th></tr></thead>
        <tbody>
          ${invoices.map(inv => `
            <tr>
              <td>${formatDate(inv.period_start)} – ${formatDate(inv.period_end)}</td>
              <td class="num tabular">${inv.total_hours}h</td>
              <td class="num tabular">${formatCurrency(inv.total_value)}</td>
              <td>${inv.status === 'paid' ? `<span class="badge badge-confirmed">Pago em ${formatDate(inv.paid_at)}</span>` : `<span class="badge badge-pending">Pendente</span>`}</td>
            </tr>
          `).join('')}
        </tbody>
      </table></div>`}
    </div>
  `;
}

async function renderAulas(el) {
  el.innerHTML = `<div class="card"><div id="prof-cal"></div></div>`;
  Calendar.mount(document.getElementById('prof-cal'), { view: 'week', refDate: new Date() }, {
    fetchClasses: async (start, end) => api.get(`/api/teacher-portal/classes?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
    onSelectClass: (cls) => {
      openModal(`
        <div class="modal-header"><h3>${escapeHtml(cls.subject_name)}</h3><button class="modal-close" id="pc-close">&times;</button></div>
        <p class="muted text-sm">${formatDate(cls.start_time)} · ${formatTime(cls.start_time)}–${formatTime(cls.end_time)}</p>
        <div class="field-row" style="margin-top:14px;">
          <div><div class="text-sm muted">Aluno</div><p>${escapeHtml(cls.student_name)}</p></div>
          <div><div class="text-sm muted">Modalidade</div><p>${cls.modality === 'online' ? 'Online' : 'Presencial'}</p></div>
        </div>
        <div>${cls.modality === 'presencial'
          ? `<div class="text-sm muted">Endereço</div><p>${cls.student_address ? escapeHtml(cls.student_address) : '<span class="muted">Aluno sem endereço cadastrado</span>'}</p>`
          : `<div class="text-sm muted">Link</div><p>${cls.meeting_link ? `<a href="${escapeHtml(cls.meeting_link)}" target="_blank" rel="noopener">Abrir link</a>` : '—'}</p>`}</div>
        <div><div class="text-sm muted">Você recebe</div><p class="tabular">${formatCurrency(cls.teacher_value)}</p></div>
      `);
      document.getElementById('pc-close').onclick = closeModal;
    },
  });
}

function renderDisponibilidade(el) {
  el.innerHTML = `
    <div class="card">
      <div class="card-header"><h2>Minha disponibilidade</h2><button class="btn btn-accent btn-sm" id="save-avail-btn">Salvar</button></div>
      <p class="text-sm muted mt-0">Isso é só uma anotação para a secretaria — não impede nem avisa sobre conflitos no agendamento.</p>
      <div id="prof-avail-grid"></div>
    </div>
  `;
  const gridApi = AvailabilityGrid.render(document.getElementById('prof-avail-grid'), currentTeacher.availability_grid || {}, { editable: true });
  document.getElementById('save-avail-btn').addEventListener('click', async () => {
    const grid = gridApi.getValue();
    await api.put('/api/teacher-portal/availability', { availability_grid: grid });
    currentTeacher.availability_grid = grid;
    showToast('Disponibilidade salva.');
  });
}

window.addEventListener('DOMContentLoaded', initProfessorApp);
