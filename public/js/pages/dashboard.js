// public/js/pages/dashboard.js

window.Pages = window.Pages || {};

Pages.dashboard = async function (root) {
  const now = new Date();
  const todayStart = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} 00:00:00`;
  const todayEnd = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} 23:59:59`;

  const [students, teachers, todayClasses, receivable, special, payable] = await Promise.all([
    api.get('/api/students'),
    api.get('/api/teachers'),
    api.get(`/api/classes?start=${encodeURIComponent(todayStart)}&end=${encodeURIComponent(todayEnd)}`),
    api.get('/api/payments/receivable'),
    api.get('/api/payments/special'),
    api.get('/api/payments/payable'),
  ]);

  const totalReceivable = receivable.reduce((s, c) => s + Number(c.student_value), 0) + special.reduce((s, c) => s + Number(c.value), 0);
  const totalPayable = payable.invoices.reduce((s, i) => s + Number(i.total_value), 0);

  todayClasses.sort((a, b) => a.start_time.localeCompare(b.start_time));

  root.innerHTML = `
    <div class="page-header">
      <div>
        <div class="eyebrow">Painel</div>
        <h1>Olá! Aqui está o resumo de hoje</h1>
        <p class="subtitle">${WEEKDAY_NAMES[now.getDay()]}, ${now.getDate()} de ${MONTH_NAMES[now.getMonth()]} de ${now.getFullYear()}</p>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Alunos ativos</div><div class="stat-value">${students.length}</div></div>
      <div class="stat-card"><div class="stat-label">Professores ativos</div><div class="stat-value">${teachers.length}</div></div>
      <div class="stat-card"><div class="stat-label">A receber (pendente)</div><div class="stat-value accent tabular">${formatCurrency(totalReceivable)}</div></div>
      <div class="stat-card"><div class="stat-label">A pagar a professores</div><div class="stat-value danger tabular">${formatCurrency(totalPayable)}</div></div>
    </div>

    <div class="card card-ruled">
      <div class="card-header"><h2>Aulas de hoje</h2>
        <a href="#/agendamento" class="btn btn-outline btn-sm">Ver agenda completa</a></div>
      ${todayClasses.length === 0 ? `<div class="empty-state"><div class="eyebrow">Nada por aqui</div>Nenhuma aula agendada para hoje.</div>` : `
      <div class="time-slot-list">
        ${todayClasses.map(c => `
          <div class="slot">
            <span class="time">${formatTime(c.start_time)}–${formatTime(c.end_time)}</span>
            <span class="grow">${escapeHtml(c.student_name)} · ${escapeHtml(c.subject_name)} <span class="muted">com ${escapeHtml(c.teacher_name)}</span></span>
            <span class="badge badge-neutral">${c.modality === 'online' ? 'Online' : 'Presencial'}</span>
          </div>
        `).join('')}
      </div>`}
    </div>

    <div class="card">
      <div class="card-header"><h2>Acesso rápido</h2></div>
      <div class="flex gap-10 wrap">
        <a href="#/alunos" class="btn btn-outline">+ Cadastrar aluno</a>
        <a href="#/professores" class="btn btn-outline">+ Cadastrar professor</a>
        <a href="#/agendamento" class="btn btn-outline">+ Agendar aula</a>
        <a href="#/pagamentos" class="btn btn-outline">Ver pagamentos</a>
      </div>
    </div>
  `;
};
