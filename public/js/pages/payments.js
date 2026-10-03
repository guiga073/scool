// public/js/pages/payments.js

window.Pages = window.Pages || {};

function typeLabel(type) {
  return { aula: 'Aula', mensalidade: 'Mensalidade', fatura_professor: 'Fatura de professor', despesa: 'Despesa' }[type] || type;
}

async function deleteHistoryItem(type, id) {
  const messages = {
    aula: 'Excluir esta aula do histórico? Ela será removida de tudo — calendários, pagamentos e cálculos de quinzena — como se nunca tivesse existido.',
    mensalidade: 'Excluir esta mensalidade do histórico?',
    fatura_professor: 'Excluir esta fatura do histórico? Se as aulas daquela quinzena ainda estiverem no sistema (e a quinzena for de até 3 meses atrás), uma nova fatura pendente pode ser gerada automaticamente de novo, já que o valor continua sendo devido ao professor com base nessas aulas. Para que o valor não volte, cancele também as aulas correspondentes, em Agendamento.',
    despesa: 'Excluir esta despesa do histórico?',
  };
  const endpoints = {
    aula: `/api/classes/${id}`,
    mensalidade: `/api/payments/monthly-charge/${id}`,
    fatura_professor: `/api/payments/invoice/${id}`,
    despesa: `/api/expenses/${id}`,
  };
  const ok = await confirmModal(`${messages[type]} Essa ação não pode ser desfeita.`, 'Excluir');
  if (!ok) return;
  await api.delete(endpoints[type]);
  showToast('Excluído do histórico.');
  return true;
}

Pages.payments = async function (root) {
  let currentTab = 'receber';
  root.innerHTML = `
    <div class="page-header">
      <div><div class="eyebrow">Financeiro</div><h1>Pagamentos</h1>
        <p class="subtitle">Pendências não desaparecem sozinhas — elas ficam aqui até serem marcadas como recebidas ou pagas.</p></div>
    </div>
    <div class="tabs">
      <button class="tab-btn active" data-tab="receber">A receber</button>
      <button class="tab-btn" data-tab="pagar">A pagar (professores)</button>
      <button class="tab-btn" data-tab="especiais">Pagamentos especiais</button>
      <button class="tab-btn" data-tab="despesas">Despesas</button>
      <button class="tab-btn" data-tab="historico">Histórico</button>
    </div>
    <div id="pay-body"></div>
  `;
  root.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTab = btn.dataset.tab;
      renderTab();
    });
  });

  async function renderTab() {
    const body = document.getElementById('pay-body');
    body.innerHTML = '<div class="loading-dots">Carregando…</div>';
    if (currentTab === 'receber') await renderReceber(body);
    else if (currentTab === 'pagar') await renderPagar(body);
    else if (currentTab === 'especiais') await renderEspeciais(body);
    else if (currentTab === 'despesas') await renderDespesas(body);
    else if (currentTab === 'historico') await renderHistorico(body);
  }

  async function renderReceber(body) {
    const rows = await api.get('/api/payments/receivable');
    const total = rows.reduce((s, r) => s + Number(r.student_value), 0);
    body.innerHTML = `
      <div class="card">
        <div class="card-header"><h2>Aulas a receber</h2><span class="badge badge-pending tabular">${formatCurrency(total)} pendente</span></div>
        ${rows.length === 0 ? `<div class="empty-state">Nada pendente por aqui.</div>` : `
        <div class="table-wrap"><table>
          <thead><tr><th>Data</th><th>Aluno</th><th>Disciplina</th><th class="num">Valor</th><th></th></tr></thead>
          <tbody>${rows.map(r => `
            <tr>
              <td>${formatDate(r.start_time)}</td>
              <td><a href="#/alunos/${r.student_id}">${escapeHtml(r.student_name)}</a></td>
              <td>${escapeHtml(r.subject_name)}</td>
              <td class="num tabular">${formatCurrency(r.student_value)}</td>
              <td><button class="btn btn-outline btn-sm" data-mark="${r.id}">Marcar recebido</button></td>
            </tr>`).join('')}</tbody>
        </table></div>`}
      </div>
    `;
    body.querySelectorAll('[data-mark]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.post(`/api/payments/class/${btn.dataset.mark}/mark-paid`);
        showToast('Marcado como recebido.');
        renderReceber(body);
      });
    });
  }

  async function renderPagar(body) {
    const { invoices, inProgress } = await api.get('/api/payments/payable');
    const total = invoices.reduce((s, r) => s + Number(r.total_value), 0);
    body.innerHTML = `
      <div class="card">
        <div class="card-header"><h2>Faturas quinzenais pendentes</h2><span class="badge badge-pending tabular">${formatCurrency(total)} pendente</span></div>
        ${invoices.length === 0 ? `<div class="empty-state">Nenhuma fatura pendente. Faturas são geradas automaticamente ao fim de cada quinzena (dia 16 e dia 1º).</div>` : `
        <div class="table-wrap"><table>
          <thead><tr><th>Professor</th><th>Período</th><th class="num">Horas</th><th class="num">Valor</th><th></th></tr></thead>
          <tbody>${invoices.map(r => `
            <tr>
              <td><a href="#/professores/${r.teacher_id}">${escapeHtml(r.teacher_name)}</a></td>
              <td>${formatDate(r.period_start)} – ${formatDate(r.period_end)}</td>
              <td class="num tabular">${r.total_hours}h</td>
              <td class="num tabular">${formatCurrency(r.total_value)}</td>
              <td><button class="btn btn-outline btn-sm" data-mark="${r.id}">Marcar pago</button></td>
            </tr>`).join('')}</tbody>
        </table></div>`}
      </div>
      <div class="card">
        <div class="card-header"><h2>Quinzenas em andamento</h2></div>
        <p class="text-sm muted mt-0">Ainda não viraram fatura — a quinzena atual só fecha no dia 16 ou no dia 1º do mês seguinte. Mostrado aqui só para acompanhamento.</p>
        ${inProgress.length === 0 ? `<div class="empty-state">Nenhuma aula lançada na quinzena atual ainda.</div>` : `
        <div class="table-wrap"><table>
          <thead><tr><th>Professor</th><th>Período</th><th class="num">Horas até agora</th><th class="num">Transporte</th><th class="num">Valor até agora</th></tr></thead>
          <tbody>${inProgress.map(r => `
            <tr><td><a href="#/professores/${r.teacher_id}">${escapeHtml(r.teacher_name)}</a></td>
              <td>${formatDate(r.period_start)} – ${formatDate(r.period_end)}</td>
              <td class="num tabular">${r.totalHours}h</td>
              <td class="num tabular">${formatCurrency(r.totalTransport)}</td>
              <td class="num tabular">${formatCurrency(r.totalValue)}</td></tr>`).join('')}</tbody>
        </table></div>`}
      </div>
    `;
    body.querySelectorAll('[data-mark]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.post(`/api/payments/invoice/${btn.dataset.mark}/mark-paid`);
        showToast('Fatura marcada como paga.');
        renderPagar(body);
      });
    });
  }

  async function renderEspeciais(body) {
    const rows = await api.get('/api/payments/special');
    const total = rows.reduce((s, r) => s + Number(r.value), 0);
    body.innerHTML = `
      <div class="card">
        <div class="card-header"><h2>Pagamentos especiais (mensalistas)</h2><span class="badge badge-pending tabular">${formatCurrency(total)} pendente</span></div>
        <p class="text-sm muted mt-0">Alunos com pagamento mensal marcado no cadastro. As aulas deles continuam no calendário normalmente, mas entram aqui em vez de na lista por aula. Toda mensalidade começa em R$ 0,00 — defina o valor de cada mês clicando em "Definir valor".</p>
        ${rows.length === 0 ? `<div class="empty-state">Nenhuma mensalidade pendente.</div>` : `
        <div class="table-wrap"><table>
          <thead><tr><th>Aluno</th><th>Referência</th><th class="num">Valor mensal</th><th></th></tr></thead>
          <tbody>${rows.map(r => `
            <tr>
              <td><a href="#/alunos/${r.student_id}">${escapeHtml(r.student_name)}</a></td>
              <td>${pad2(r.month)}/${r.year}</td>
              <td class="num tabular">${formatCurrency(r.value)}</td>
              <td class="flex gap-8">
                <button class="btn btn-outline btn-sm" data-edit="${r.id}" data-current="${r.value}">${Number(r.value) > 0 ? 'Editar valor' : 'Definir valor'}</button>
                <button class="btn btn-outline btn-sm" data-mark="${r.id}">Marcar recebido</button>
              </td>
            </tr>`).join('')}</tbody>
        </table></div>`}
      </div>
    `;
    body.querySelectorAll('[data-mark]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.post(`/api/payments/monthly-charge/${btn.dataset.mark}/mark-paid`);
        showToast('Mensalidade marcada como recebida.');
        renderEspeciais(body);
      });
    });
    body.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const chargeId = btn.dataset.edit;
        const backdrop = openModal(`
          <div class="modal-header"><h3>Valor da mensalidade</h3><button class="modal-close" id="mv-close">&times;</button></div>
          <form id="monthly-value-form">
            <div class="field"><label for="mv-value">Valor (R$)</label>
              <input type="number" step="0.01" min="0" id="mv-value" value="${btn.dataset.current}" required autofocus></div>
            <div class="form-actions"><button type="button" class="btn btn-outline" id="mv-cancel">Cancelar</button><button type="submit" class="btn btn-primary">Salvar</button></div>
          </form>
        `);
        backdrop.querySelector('#mv-close').onclick = closeModal;
        backdrop.querySelector('#mv-cancel').onclick = closeModal;
        backdrop.querySelector('#monthly-value-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          await api.put(`/api/payments/monthly-charge/${chargeId}`, { value: Number(backdrop.querySelector('#mv-value').value) });
          closeModal();
          showToast('Valor atualizado.');
          renderEspeciais(body);
        });
      });
    });
  }

  async function renderDespesas(body) {
    const [rows, recurring] = await Promise.all([api.get('/api/expenses'), api.get('/api/expenses/recurring')]);
    const total = rows.reduce((s, r) => s + Number(r.value), 0);
    body.innerHTML = `
      <div class="card">
        <div class="card-header"><h2>Despesas</h2>
          <div class="flex gap-10"><span class="badge badge-pending tabular">${formatCurrency(total)} pendente</span>
          <button class="btn btn-accent btn-sm" id="add-expense-btn">+ Nova despesa</button></div></div>
        ${rows.length === 0 ? `<div class="empty-state">Nenhuma despesa pendente.</div>` : `
        <div class="table-wrap"><table>
          <thead><tr><th>Descrição</th><th>Vencimento</th><th class="num">Valor</th><th></th></tr></thead>
          <tbody>${rows.map(r => `
            <tr>
              <td>${escapeHtml(r.description)} ${r.recurring_expense_id ? '<span class="badge badge-neutral">Recorrente</span>' : ''}</td>
              <td>${r.due_date ? formatDate(r.due_date + ' 00:00:00') : '—'}</td>
              <td class="num tabular">${formatCurrency(r.value)}</td>
              <td><button class="btn btn-outline btn-sm" data-mark="${r.id}">Marcar paga</button></td>
            </tr>`).join('')}</tbody>
        </table></div>`}
      </div>
      <div class="card">
        <div class="card-header"><h2>Despesas recorrentes</h2>
          <button class="btn btn-outline btn-sm" id="add-recurring-btn">+ Nova despesa recorrente</button></div>
        <p class="text-sm muted mt-0">Assinaturas e outras contas fixas do negócio. Geram sozinhas uma despesa todo mês, no dia escolhido — você só marca como paga quando quitar.</p>
        <div id="recurring-list"></div>
      </div>
    `;
    body.querySelectorAll('[data-mark]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.post(`/api/expenses/${btn.dataset.mark}/mark-paid`);
        showToast('Despesa marcada como paga.');
        renderDespesas(body);
      });
    });
    document.getElementById('add-expense-btn').addEventListener('click', () => {
      const backdrop = openModal(`
        <div class="modal-header"><h3>Nova despesa</h3><button class="modal-close" id="ef-close">&times;</button></div>
        <form id="expense-form">
          <div class="field"><label for="ef-desc">Descrição</label><input type="text" id="ef-desc" required placeholder="Ex.: Conta de telefone"></div>
          <div class="field-row">
            <div class="field"><label for="ef-value">Valor (R$)</label><input type="number" step="0.01" min="0" id="ef-value" required></div>
            <div class="field"><label for="ef-due">Vencimento (opcional)</label><input type="date" id="ef-due"></div>
          </div>
          <div class="form-actions"><button type="button" class="btn btn-outline" id="ef-cancel">Cancelar</button><button type="submit" class="btn btn-primary">Salvar</button></div>
        </form>
      `);
      backdrop.querySelector('#ef-close').onclick = closeModal;
      backdrop.querySelector('#ef-cancel').onclick = closeModal;
      backdrop.querySelector('#expense-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await api.post('/api/expenses', {
          description: backdrop.querySelector('#ef-desc').value.trim(),
          value: Number(backdrop.querySelector('#ef-value').value),
          due_date: backdrop.querySelector('#ef-due').value || null,
        });
        closeModal();
        showToast('Despesa adicionada.');
        renderDespesas(body);
      });
    });

    const recListEl = document.getElementById('recurring-list');
    if (recurring.length === 0) {
      recListEl.innerHTML = `<div class="empty-state text-sm" style="padding:16px;">Nenhuma despesa recorrente cadastrada.</div>`;
    } else {
      recListEl.innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>Descrição</th><th>Dia do mês</th><th class="num">Valor</th><th></th></tr></thead>
        <tbody>${recurring.map(r => `
          <tr>
            <td>${escapeHtml(r.description)}</td>
            <td>Todo dia ${r.day_of_month}</td>
            <td class="num tabular">${formatCurrency(r.value)}</td>
            <td class="flex gap-8">
              <button class="btn btn-outline btn-sm" data-edit-rec="${r.id}">Editar</button>
              <button class="btn-text text-sm" data-del-rec="${r.id}">Desativar</button>
            </td>
          </tr>`).join('')}</tbody>
      </table></div>`;
      recListEl.querySelectorAll('[data-del-rec]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const ok = await confirmModal('Desativar esta despesa recorrente? Ela para de gerar cobranças novas a partir do próximo mês. A despesa deste mês, se já tiver sido gerada, continua normalmente até você marcar como paga.', 'Desativar');
          if (!ok) return;
          await api.delete(`/api/expenses/recurring/${btn.dataset.delRec}`);
          showToast('Despesa recorrente desativada.');
          renderDespesas(body);
        });
      });
      recListEl.querySelectorAll('[data-edit-rec]').forEach(btn => {
        btn.addEventListener('click', () => {
          const r = recurring.find(x => String(x.id) === btn.dataset.editRec);
          openRecurringExpenseModal(r, body);
        });
      });
    }

    document.getElementById('add-recurring-btn').addEventListener('click', () => openRecurringExpenseModal(null, body));
  }

  function openRecurringExpenseModal(existing, body) {
    const r = existing || {};
    const backdrop = openModal(`
      <div class="modal-header"><h3>${existing ? 'Editar despesa recorrente' : 'Nova despesa recorrente'}</h3><button class="modal-close" id="rf-close">&times;</button></div>
      <form id="recurring-form">
        <div class="field"><label for="rf-desc">Descrição</label>
          <input type="text" id="rf-desc" required placeholder="Ex.: Assinatura do Zoom" value="${escapeHtml(r.description || '')}"></div>
        <div class="field-row">
          <div class="field"><label for="rf-value">Valor mensal (R$)</label><input type="number" step="0.01" min="0" id="rf-value" required value="${r.value != null ? r.value : ''}"></div>
          <div class="field"><label for="rf-day">Dia do mês</label><input type="number" min="1" max="31" id="rf-day" required value="${r.day_of_month || 1}"></div>
        </div>
        <div class="hint">Em meses mais curtos que o dia escolhido (ex.: dia 31 em fevereiro), a despesa é gerada no último dia do mês.</div>
        <div class="form-actions"><button type="button" class="btn btn-outline" id="rf-cancel">Cancelar</button><button type="submit" class="btn btn-primary">Salvar</button></div>
      </form>
    `);
    backdrop.querySelector('#rf-close').onclick = closeModal;
    backdrop.querySelector('#rf-cancel').onclick = closeModal;
    backdrop.querySelector('#recurring-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        description: backdrop.querySelector('#rf-desc').value.trim(),
        value: Number(backdrop.querySelector('#rf-value').value),
        day_of_month: Number(backdrop.querySelector('#rf-day').value),
      };
      if (existing) await api.put(`/api/expenses/recurring/${existing.id}`, payload);
      else await api.post('/api/expenses/recurring', payload);
      closeModal();
      showToast(existing ? 'Despesa recorrente atualizada.' : 'Despesa recorrente criada.');
      renderDespesas(body);
    });
  }

  async function renderHistorico(body) {
    let selectedStudent = null;
    let viewYear = new Date().getFullYear();
    let viewMonth = new Date().getMonth() + 1;

    body.innerHTML = `
      <div class="card">
        <div class="card-header"><h2>Buscar por aluno</h2></div>
        <p class="text-sm muted mt-0">Busque pelo nome do aluno ou do responsável para ver quais aulas do mês já foram pagas.</p>
        <input type="text" class="search-input" id="hist-search" placeholder="Nome do aluno ou do responsável…">
        <div id="hist-search-results" style="margin-top:10px;"></div>
      </div>
      <div id="hist-student-detail"></div>
      <div id="hist-general"></div>
    `;

    const searchInput = document.getElementById('hist-search');
    const resultsEl = document.getElementById('hist-search-results');
    const detailEl = document.getElementById('hist-student-detail');
    const generalEl = document.getElementById('hist-general');

    let debounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(runSearch, 250);
    });

    async function runSearch() {
      const q = searchInput.value.trim();
      if (!q) {
        resultsEl.innerHTML = '';
        detailEl.innerHTML = '';
        selectedStudent = null;
        renderGeneral();
        return;
      }
      const students = await api.get(`/api/payments/student-search?q=${encodeURIComponent(q)}`);
      if (students.length === 0) {
        resultsEl.innerHTML = `<div class="empty-state text-sm" style="padding:12px;">Nenhum aluno encontrado.</div>`;
        detailEl.innerHTML = '';
        generalEl.innerHTML = '';
        return;
      }
      resultsEl.innerHTML = `<div class="pill-toggle">${students.map(s => `
        <button type="button" data-id="${s.id}" class="${selectedStudent && selectedStudent.id === s.id ? 'active' : ''}">
          ${escapeHtml(s.name)}${s.guardian_name ? ` <span class="muted">(resp.: ${escapeHtml(s.guardian_name)})</span>` : ''}
        </button>`).join('')}</div>`;
      resultsEl.querySelectorAll('button[data-id]').forEach(btn => {
        btn.addEventListener('click', () => {
          resultsEl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          selectedStudent = students.find(s => String(s.id) === btn.dataset.id);
          const now = new Date();
          viewYear = now.getFullYear(); viewMonth = now.getMonth() + 1;
          generalEl.innerHTML = '';
          renderStudentMonth();
        });
      });
    }

    async function renderStudentMonth() {
      detailEl.innerHTML = `<div class="card"><div class="loading-dots">Carregando…</div></div>`;
      const data = await api.get(`/api/payments/student/${selectedStudent.id}/month?year=${viewYear}&month=${viewMonth}`);
      const totalPending = data.classes.filter(c => !c.student_paid).reduce((s, c) => s + Number(c.student_value), 0)
        + (data.monthlyCharge && data.monthlyCharge.status === 'pending' ? Number(data.monthlyCharge.value) : 0);

      detailEl.innerHTML = `
        <div class="card card-ruled">
          <div class="card-header">
            <h2>${escapeHtml(selectedStudent.name)}</h2>
            <div class="calendar-nav">
              <button class="btn btn-outline btn-sm" id="hist-prev-month">&larr;</button>
              <span class="label" style="font-size:15px; min-width:140px;">${MONTH_NAMES[viewMonth - 1]} de ${viewYear}</span>
              <button class="btn btn-outline btn-sm" id="hist-next-month">&rarr;</button>
            </div>
          </div>
          ${totalPending > 0 ? `<div class="alert alert-info">${formatCurrency(totalPending)} pendente neste mês.</div>` : `<div class="alert alert-info">Tudo pago neste mês. ✓</div>`}
          ${data.monthlyCharge ? `
            <div class="flex-between" style="padding:10px 0; border-bottom:1px solid var(--border);">
              <span>Mensalidade de ${MONTH_NAMES[viewMonth - 1]}</span>
              <span class="flex gap-8">
                <span class="tabular">${formatCurrency(data.monthlyCharge.value)}</span>
                ${data.monthlyCharge.status === 'paid' ? '<span class="badge badge-confirmed">Pago</span>' : '<span class="badge badge-pending">Pendente</span>'}
              </span>
            </div>` : ''}
          ${data.classes.length === 0 ? `<div class="empty-state">Nenhuma aula neste mês.</div>` : `
          <div class="table-wrap"><table>
            <thead><tr><th>Data</th><th>Disciplina</th><th>Professor</th><th class="num">Valor</th><th>Status</th></tr></thead>
            <tbody>${data.classes.map(c => `
              <tr>
                <td>${formatDate(c.start_time)}</td>
                <td>${escapeHtml(c.subject_name)}</td>
                <td>${escapeHtml(c.teacher_name)}</td>
                <td class="num tabular">${formatCurrency(c.student_value)}</td>
                <td>${c.student_paid ? '<span class="badge badge-confirmed">Pago</span>' : '<span class="badge badge-pending">Pendente</span>'}</td>
              </tr>`).join('')}</tbody>
          </table></div>`}
        </div>
      `;
      document.getElementById('hist-prev-month').addEventListener('click', () => {
        viewMonth--; if (viewMonth < 1) { viewMonth = 12; viewYear--; }
        renderStudentMonth();
      });
      document.getElementById('hist-next-month').addEventListener('click', () => {
        viewMonth++; if (viewMonth > 12) { viewMonth = 1; viewYear++; }
        renderStudentMonth();
      });
    }

    let generalCategory = 'alunos';

    async function renderGeneral() {
      generalEl.innerHTML = `
        <div class="card">
          <div class="card-header"><h2>Histórico geral</h2>
            <div class="pill-toggle" id="hist-cat-toggle">
              <button type="button" data-cat="alunos" class="${generalCategory === 'alunos' ? 'active' : ''}">Recebido de alunos</button>
              <button type="button" data-cat="professores" class="${generalCategory === 'professores' ? 'active' : ''}">Pago a professores</button>
              <button type="button" data-cat="despesas" class="${generalCategory === 'despesas' ? 'active' : ''}">Pago em despesas</button>
            </div>
          </div>
          <div id="hist-cat-body"><div class="loading-dots">Carregando…</div></div>
        </div>
      `;
      document.querySelectorAll('#hist-cat-toggle button').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#hist-cat-toggle button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          generalCategory = btn.dataset.cat;
          renderCategoryBody();
        });
      });
      renderCategoryBody();
    }

    async function renderCategoryBody() {
      const catBody = document.getElementById('hist-cat-body');
      catBody.innerHTML = '<div class="loading-dots">Carregando…</div>';
      const rows = await api.get('/api/payments/history');
      const typesByCategory = {
        alunos: ['aula', 'mensalidade'],
        professores: ['fatura_professor'],
        despesas: ['despesa'],
      };
      const filtered = rows.filter(r => typesByCategory[generalCategory].includes(r.type));

      if (filtered.length === 0) {
        catBody.innerHTML = `<div class="empty-state">Nada por aqui ainda.</div>`;
        return;
      }

      // Agrupa por mês (a partir de paid_at), do mais recente pro mais antigo.
      const groups = new Map();
      for (const r of filtered) {
        const key = String(r.paid_at || '').slice(0, 7) || 'sem-data';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }
      const sortedKeys = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));

      // Cada categoria só tem um tipo de registro, então a coluna de "referência" pode
      // ter um nome específico e autoexplicativo, em vez de um genérico "Referência".
      const referenceLabel = { alunos: 'Data da aula', professores: 'Início da quinzena', despesas: 'Vencimento' }[generalCategory];
      const nameLabel = { alunos: 'Aluno', professores: 'Professor', despesas: 'Descrição' }[generalCategory];

      catBody.innerHTML = sortedKeys.map(key => {
        const items = groups.get(key);
        const subtotal = items.reduce((s, r) => s + Number(r.value), 0);
        const [y, m] = key.split('-');
        const label = (y && m) ? `${MONTH_NAMES[Number(m) - 1]} de ${y}` : 'Sem data de pagamento';
        return `
          <div class="day-section-title" style="display:flex; justify-content:space-between; align-items:center;">
            <span>${label}</span><span class="tabular">${formatCurrency(subtotal)}</span>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>${nameLabel}</th><th>${referenceLabel}</th><th class="num">Valor</th><th>Pago/recebido em</th><th></th></tr></thead>
            <tbody>${items.map(r => `
              <tr>
                <td>${escapeHtml(r.name)}</td>
                <td>${escapeHtml(String(r.reference_date || '').slice(0, 10))}</td>
                <td class="num tabular">${formatCurrency(r.value)}</td>
                <td>${r.paid_at ? formatDateTime(r.paid_at) : '—'}</td>
                <td><button class="btn-text text-sm" data-del-hist="${r.id}" data-type="${r.type}">Excluir</button></td>
              </tr>`).join('')}</tbody>
          </table></div>
        `;
      }).join('');

      catBody.querySelectorAll('[data-del-hist]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const deleted = await deleteHistoryItem(btn.dataset.type, btn.dataset.delHist);
          if (deleted) renderCategoryBody();
        });
      });
    }

    renderGeneral();
  }

  renderTab();
};
