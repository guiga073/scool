// public/js/pages/payments.js

window.Pages = window.Pages || {};

function typeLabel(type) {
  return { aula: 'Aula', mensalidade: 'Mensalidade', fatura_professor: 'Fatura de professor', despesa: 'Despesa' }[type] || type;
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
          <thead><tr><th>Professor</th><th>Período</th><th class="num">Horas até agora</th><th class="num">Valor até agora</th></tr></thead>
          <tbody>${inProgress.map(r => `
            <tr><td><a href="#/professores/${r.teacher_id}">${escapeHtml(r.teacher_name)}</a></td>
              <td>${formatDate(r.period_start)} – ${formatDate(r.period_end)}</td>
              <td class="num tabular">${r.totalHours}h</td><td class="num tabular">${formatCurrency(r.totalValue)}</td></tr>`).join('')}</tbody>
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
        <p class="text-sm muted mt-0">Alunos com pagamento mensal marcado no cadastro. As aulas deles continuam no calendário normalmente, mas entram aqui em vez de na lista por aula.</p>
        ${rows.length === 0 ? `<div class="empty-state">Nenhuma mensalidade pendente.</div>` : `
        <div class="table-wrap"><table>
          <thead><tr><th>Aluno</th><th>Referência</th><th class="num">Valor mensal</th><th></th></tr></thead>
          <tbody>${rows.map(r => `
            <tr>
              <td><a href="#/alunos/${r.student_id}">${escapeHtml(r.student_name)}</a></td>
              <td>${pad2(r.month)}/${r.year}</td>
              <td class="num tabular">${formatCurrency(r.value)}</td>
              <td><button class="btn btn-outline btn-sm" data-mark="${r.id}">Marcar recebido</button></td>
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
  }

  async function renderDespesas(body) {
    const rows = await api.get('/api/expenses');
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
              <td>${escapeHtml(r.description)}</td>
              <td>${r.due_date ? formatDate(r.due_date + ' 00:00:00') : '—'}</td>
              <td class="num tabular">${formatCurrency(r.value)}</td>
              <td><button class="btn btn-outline btn-sm" data-mark="${r.id}">Marcar paga</button></td>
            </tr>`).join('')}</tbody>
        </table></div>`}
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
  }

  async function renderHistorico(body) {
    const rows = await api.get('/api/payments/history');
    body.innerHTML = `
      <div class="card">
        <div class="card-header"><h2>Histórico de pagamentos e recebimentos</h2></div>
        ${rows.length === 0 ? `<div class="empty-state">Nada no histórico ainda.</div>` : `
        <div class="table-wrap"><table>
          <thead><tr><th>Tipo</th><th>Nome</th><th>Referência</th><th class="num">Valor</th><th>Data</th></tr></thead>
          <tbody>${rows.map(r => `
            <tr>
              <td><span class="badge badge-neutral">${typeLabel(r.type)}</span></td>
              <td>${escapeHtml(r.name)}</td>
              <td>${escapeHtml(String(r.reference_date || '').slice(0, 10))}</td>
              <td class="num tabular">${formatCurrency(r.value)}</td>
              <td>${r.paid_at ? formatDateTime(r.paid_at) : '—'}</td>
            </tr>`).join('')}</tbody>
        </table></div>`}
      </div>
    `;
  }

  renderTab();
};
