// public/js/pages/payments.js

window.Pages = window.Pages || {};

function typeLabel(type) {
  return { aula: 'Aula', mensalidade: 'Mensalidade', fatura_professor: 'Fatura de professor', despesa: 'Despesa' }[type] || type;
}

function pluralPt(n, one, many) {
  return `${n} ${Number(n) === 1 ? one : many}`;
}

// Agrupa as aulas avulsas pendentes por aluno e, dentro de cada aluno, por mês.
// `happened` vem do servidor (a aula já começou). Cada aluno traz o que é devido agora
// (aulas já realizadas sem pagamento) separado do que ainda vai acontecer.
function groupReceivable(rows) {
  const students = new Map();
  for (const r of rows) {
    if (!students.has(r.student_id)) {
      students.set(r.student_id, {
        student_id: r.student_id, student_name: r.student_name,
        dueTotal: 0, dueCount: 0, upcomingTotal: 0, upcomingCount: 0, firstDue: null, months: new Map(),
      });
    }
    const g = students.get(r.student_id);
    const value = Number(r.student_value) || 0;
    if (r.happened) {
      g.dueTotal += value; g.dueCount++;
      if (!g.firstDue || r.start_time < g.firstDue) g.firstDue = r.start_time;
    } else {
      g.upcomingTotal += value; g.upcomingCount++;
    }
    const key = String(r.start_time).slice(0, 7);
    if (!g.months.has(key)) g.months.set(key, { key, rows: [], total: 0, dueCount: 0, upcomingCount: 0 });
    const m = g.months.get(key);
    m.rows.push(r); m.total += value;
    if (r.happened) m.dueCount++; else m.upcomingCount++;
  }
  const groups = Array.from(students.values()).map((g) => ({
    ...g,
    months: Array.from(g.months.values())
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((m) => ({ ...m, rows: m.rows.slice().sort((a, b) => a.start_time.localeCompare(b.start_time)) })),
  }));
  groups.sort((a, b) => {
    if ((a.dueCount > 0) !== (b.dueCount > 0)) return a.dueCount > 0 ? -1 : 1;   // quem deve agora vem primeiro
    if (a.dueCount > 0) return a.firstDue.localeCompare(b.firstDue);              // dívida mais antiga primeiro
    return a.student_name.localeCompare(b.student_name, 'pt-BR');
  });
  const totals = groups.reduce((t, g) => ({
    dueTotal: t.dueTotal + g.dueTotal, dueCount: t.dueCount + g.dueCount,
    upcomingTotal: t.upcomingTotal + g.upcomingTotal, upcomingCount: t.upcomingCount + g.upcomingCount,
  }), { dueTotal: 0, dueCount: 0, upcomingTotal: 0, upcomingCount: 0 });
  return { groups, totals };
}

// Volta um item do Histórico para "pendente" (desfaz um "marcar como recebido/pago").
async function undoHistoryItem(type, id) {
  const endpoints = {
    aula: `/api/payments/class/${id}/mark-pending`,
    mensalidade: `/api/payments/monthly-charge/${id}/mark-pending`,
    fatura_professor: `/api/payments/invoice/${id}/mark-pending`,
    despesa: `/api/expenses/${id}/mark-pending`,
  };
  const ok = await confirmModal('Voltar este item para pendente? Ele sai do Histórico e do Financeiro e volta para a lista de pendências, até você marcá-lo de novo.', 'Voltar para pendente');
  if (!ok) return false;
  await api.post(endpoints[type]);
  showToast('Voltou para pendente.');
  return true;
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
  let currentTab = 'avulsos';
  root.innerHTML = `
    <div class="page-header">
      <div><div class="eyebrow">Financeiro</div><h1>Pagamentos</h1>
        <p class="subtitle">Pendências não desaparecem sozinhas — elas ficam aqui até serem marcadas como recebidas ou pagas. Marcou algo por engano? Toque em <strong>Desfazer</strong> na mensagem que aparece logo depois, ou use <strong>Voltar para pendente</strong> no Histórico.</p></div>
    </div>
    <div class="tabs">
      <button class="tab-btn active" data-tab="avulsos">Pagamentos avulsos</button>
      <button class="tab-btn" data-tab="mensais">Pagamentos mensais</button>
      <button class="tab-btn" data-tab="pagar">A pagar (professores)</button>
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
      searchQuery = '';
      renderTab();
    });
  });

  let searchQuery = '';            // texto digitado na busca por nome (vale para a aba aberta)

  // minúsculas e sem acento: "José", "jose" e "JOSÉ" são a mesma coisa
  const normalizeText = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  function searchBarHtml(placeholder) {
    return `<div class="search-bar">
      <div class="search-field">
        <input type="search" class="search-input" id="pay-search" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(placeholder)}" value="${escapeHtml(searchQuery)}" autocomplete="off">
        <button type="button" class="search-clear hidden" id="pay-search-clear" aria-label="Limpar busca">&times;</button>
      </div>
      <span class="search-count" id="pay-search-count"></span>
    </div>`;
  }
  const searchEmptyHtml = (what, nested) => nested
    ? `<div class="empty-state hidden" id="pay-search-empty">Nenhum ${what} encontrado para “<span class="pay-search-q"></span>”.</div>`
    : `<div class="card hidden" id="pay-search-empty"><div class="empty-state">Nenhum ${what} encontrado para “<span class="pay-search-q"></span>”.</div></div>`;

  // Liga a caixa de busca (já desenhada no HTML) à lista da aba. Cada item da lista tem data-search (o nome,
  // sem acento) e, se for dinheiro, data-value. Quem tem várias palavras ("ana paula") só aparece se tiver
  // todas. Os grupos (.pay-group) somem quando ficam sem itens e, se tiverem um .pay-group-total, passam a
  // mostrar a soma só do que sobrou. Escape ou o X limpam a busca.
  function makeFilter(scope, itemSel) {
    itemSel = itemSel || '.pay-item';
    const input = scope.querySelector('#pay-search');
    if (!input) return { apply() {} };
    const clearBtn = scope.querySelector('#pay-search-clear');
    const countEl = scope.querySelector('#pay-search-count');
    const emptyEl = scope.querySelector('#pay-search-empty');
    function apply() {
      const tokens = normalizeText(searchQuery).split(/\s+/).filter(Boolean);
      const items = Array.from(scope.querySelectorAll(itemSel));
      let visible = 0;
      items.forEach((el) => {
        const hay = el.dataset.search || '';
        const match = tokens.every((t) => hay.includes(t));
        el.classList.toggle('hidden', !match);
        if (match) visible++;
      });
      scope.querySelectorAll('.pay-group').forEach((g) => {
        const all = Array.from(g.querySelectorAll(itemSel));
        const shown = all.filter((el) => !el.classList.contains('hidden'));
        if (all.length) g.classList.toggle('hidden', shown.length === 0);
        const totalEl = g.querySelector('.pay-group-total');
        if (totalEl) totalEl.textContent = formatCurrency(shown.reduce((sum, el) => sum + (Number(el.dataset.value) || 0), 0)) + (totalEl.dataset.suffix || '');
      });
      clearBtn.classList.toggle('hidden', !searchQuery);
      countEl.textContent = tokens.length ? `Mostrando ${visible} de ${items.length}` : '';
      if (emptyEl) {
        emptyEl.classList.toggle('hidden', !(tokens.length && visible === 0));
        const q = emptyEl.querySelector('.pay-search-q');
        if (q) q.textContent = searchQuery.trim();
      }
    }
    input.addEventListener('input', () => { searchQuery = input.value; apply(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; searchQuery = ''; apply(); } });
    clearBtn.addEventListener('click', () => { input.value = ''; searchQuery = ''; apply(); input.focus(); });
    apply();
    return { apply };
  }

  // Recarrega a aba aberta com os dados novos (sem piscar "Carregando"). Se a pessoa já foi para outra aba
  // ou saiu da página, não há nada a fazer: ao voltar, a lista é buscada de novo.
  function refreshTab(tab) {
    const body = document.getElementById('pay-body');
    if (!body || currentTab !== tab) return;
    ({ avulsos: renderAvulsos, mensais: renderMensais, pagar: renderPagar, despesas: renderDespesas })[tab](body);
  }

  // Depois de marcar algo como pago/recebido: aviso com "Desfazer" (12 s) que reverte exatamente aquele clique.
  function offerUndo(tab, message, undoFn) {
    showToast(message, null, {
      actionLabel: 'Desfazer',
      onAction: async () => {
        await undoFn();
        showToast('Desfeito: voltou para pendente.');
        refreshTab(tab);
      },
    });
  }

  async function renderTab() {
    const body = document.getElementById('pay-body');
    body.innerHTML = '<div class="loading-dots">Carregando…</div>';
    if (currentTab === 'avulsos') await renderAvulsos(body);
    else if (currentTab === 'mensais') await renderMensais(body);
    else if (currentTab === 'pagar') await renderPagar(body);
    else if (currentTab === 'despesas') await renderDespesas(body);
    else if (currentTab === 'historico') await renderHistorico(body);
  }

  async function renderAvulsos(body) {
    const rows = await api.get('/api/payments/receivable');
    const { groups, totals } = groupReceivable(rows);
    const monthLabel = (key) => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} de ${key.slice(0, 4)}`;

    body.innerHTML = `
      ${groups.length > 0 ? searchBarHtml('Buscar aluno pelo nome…') + searchEmptyHtml('aluno') : ''}
      <div class="card">
        <div class="card-header"><h2>Pagamentos avulsos</h2>
          <span class="badge badge-pending tabular">${formatCurrency(totals.dueTotal)} a receber agora</span></div>
        <p class="text-sm muted mt-0">Alunos que pagam <strong>por aula</strong>: cada aula é cobrada separadamente. Alunos marcados como pagamento mensal no cadastro não aparecem aqui — ficam em "Pagamentos mensais".
          "A receber agora" soma só as aulas que <strong>já aconteceram</strong> e ainda não foram pagas. As aulas futuras já agendadas aparecem em cada aluno, mas só viram cobrança quando acontecerem — se o aluno pagar adiantado, dá para marcar como recebido antes.</p>
        ${totals.upcomingCount > 0 ? `<p class="text-sm muted" style="margin-bottom:0;">Além disso: ${formatCurrency(totals.upcomingTotal)} em ${pluralPt(totals.upcomingCount, 'aula futura já agendada', 'aulas futuras já agendadas')}, ainda não vencidas.</p>` : ''}
      </div>
      ${groups.length === 0 ? `<div class="card"><div class="empty-state">Nada pendente por aqui.</div></div>` : groups.map((g, gi) => `
        <div class="card pay-item" data-search="${escapeHtml(normalizeText(g.student_name))}">
          <div class="card-header">
            <h2><a href="#/alunos/${g.student_id}">${escapeHtml(g.student_name)}</a></h2>
            <span class="flex gap-8">
              ${g.dueCount > 0 ? `<span class="badge badge-pending tabular">${formatCurrency(g.dueTotal)} a receber agora</span>` : ''}
              ${g.upcomingCount > 0 ? `<span class="badge badge-neutral tabular">${formatCurrency(g.upcomingTotal)} em aulas futuras</span>` : ''}
            </span>
          </div>
          ${g.months.map((m, mi) => `
            <div class="day-section-title" style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
              <span>${monthLabel(m.key)} · ${pluralPt(m.rows.length, 'aula', 'aulas')}</span>
              <span class="flex gap-8" style="align-items:center;">
                <span class="tabular">${formatCurrency(m.total)}</span>
                <button class="btn btn-outline btn-sm" data-bulk="${gi}:${mi}">Marcar o mês como recebido</button>
              </span>
            </div>
            <div class="table-wrap"><table>
              <thead><tr><th>Data</th><th>Disciplina</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead>
              <tbody>${m.rows.map(r => `
                <tr>
                  <td>${formatDate(r.start_time)}</td>
                  <td>${escapeHtml(r.subject_name)}</td>
                  <td class="num tabular">${formatCurrency(r.student_value)}</td>
                  <td>${r.happened ? '<span class="badge badge-pending">A receber</span>' : '<span class="badge badge-neutral">Ainda não aconteceu</span>'}</td>
                  <td><button class="btn btn-outline btn-sm" data-mark="${r.id}">Marcar recebido</button></td>
                </tr>`).join('')}</tbody>
            </table></div>
          `).join('')}
        </div>`).join('')}
    `;

    makeFilter(body);

    body.querySelectorAll('[data-mark]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.mark;
        const r = rows.find(x => String(x.id) === String(id));
        btn.disabled = true;
        await api.post(`/api/payments/class/${id}/mark-paid`);
        offerUndo('avulsos', `Recebido de ${r.student_name}: aula de ${formatDate(r.start_time)} (${formatCurrency(r.student_value)}).`,
          () => api.post(`/api/payments/class/${id}/mark-pending`));
        renderAvulsos(body);
      });
    });

    // Receber o mês de um aluno de uma vez. Confirmação explícita porque mexe em várias aulas
    // (e, se houver aulas futuras no mês, é um pagamento antecipado).
    body.querySelectorAll('[data-bulk]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const [gi, mi] = btn.dataset.bulk.split(':').map(Number);
        const g = groups[gi];
        const m = g.months[mi];
        const ids = m.rows.map(r => r.id);
        const ok = await confirmModal(
          `Marcar ${pluralPt(ids.length, 'aula', 'aulas')} de ${g.student_name} em ${monthLabel(m.key)} como ${ids.length === 1 ? 'recebida' : 'recebidas'}, num total de ${formatCurrency(m.total)}?` +
          (m.upcomingCount > 0 ? ` Isso inclui ${pluralPt(m.upcomingCount, 'aula que ainda não aconteceu', 'aulas que ainda não aconteceram')} (pagamento antecipado).` : '') +
          ' Se marcar sem querer, aparece um botão Desfazer logo em seguida (e também dá para voltar para pendente pelo Histórico).',
          'Marcar como recebidas'
        );
        if (!ok) return;
        const res = await api.post('/api/payments/class/mark-paid-bulk', { ids });
        const done = Array.isArray(res.ids) ? res.ids : ids;     // o Desfazer reverte só o que ESTE clique marcou
        if (done.length > 0) {
          offerUndo('avulsos', `${pluralPt(res.updated, 'aula marcada como recebida', 'aulas marcadas como recebidas')} (${g.student_name}, ${monthLabel(m.key)}).`,
            () => api.post('/api/payments/class/mark-pending-bulk', { ids: done }));
        } else {
          showToast('Nenhuma aula mudou: já estavam marcadas.');
        }
        renderAvulsos(body);
      });
    });
  }

  async function renderPagar(body) {
    const { invoices, inProgress } = await api.get('/api/payments/payable');
    const total = invoices.reduce((s, r) => s + Number(r.total_value), 0);
    body.innerHTML = `
      ${(invoices.length + inProgress.length) > 0 ? searchBarHtml('Buscar professor pelo nome…') + searchEmptyHtml('professor') : ''}
      <div class="card pay-group">
        <div class="card-header"><h2>Faturas quinzenais pendentes</h2><span class="badge badge-pending tabular pay-group-total" data-suffix=" pendente">${formatCurrency(total)} pendente</span></div>
        ${invoices.length === 0 ? `<div class="empty-state">Nenhuma fatura pendente. Faturas são geradas automaticamente ao fim de cada quinzena (dia 16 e dia 1º).</div>` : `
        <div class="table-wrap"><table>
          <thead><tr><th>Professor</th><th>Período</th><th class="num">Horas</th><th class="num">Valor</th><th></th></tr></thead>
          <tbody>${invoices.map(r => `
            <tr class="pay-item" data-search="${escapeHtml(normalizeText(r.teacher_name))}" data-value="${Number(r.total_value) || 0}">
              <td><a href="#/professores/${r.teacher_id}">${escapeHtml(r.teacher_name)}</a></td>
              <td>${formatDate(r.period_start)} – ${formatDate(r.period_end)}</td>
              <td class="num tabular">${r.total_hours}h</td>
              <td class="num tabular">${formatCurrency(r.total_value)}</td>
              <td><button class="btn btn-outline btn-sm" data-mark="${r.id}">Marcar pago</button></td>
            </tr>`).join('')}</tbody>
        </table></div>`}
      </div>
      <div class="card pay-group">
        <div class="card-header"><h2>Quinzenas em andamento</h2></div>
        <p class="text-sm muted mt-0">Ainda não viraram fatura — a quinzena atual só fecha no dia 16 ou no dia 1º do mês seguinte. <strong>Previsto</strong> é o que a fatura terá se nada mudar: soma todas as aulas agendadas na quinzena, as que já aconteceram e as que ainda vão acontecer. <strong>Já dado</strong> é só a parte que já aconteceu até agora.</p>
        ${inProgress.length === 0 ? `<div class="empty-state">Nenhuma aula lançada na quinzena atual ainda.</div>` : `
        <div class="table-wrap"><table>
          <thead><tr><th>Professor</th><th>Período</th><th class="num">Já dado</th><th class="num">Previsto na quinzena</th></tr></thead>
          <tbody>${inProgress.map(r => `
            <tr class="pay-item" data-search="${escapeHtml(normalizeText(r.teacher_name))}"><td><a href="#/professores/${r.teacher_id}">${escapeHtml(r.teacher_name)}</a></td>
              <td>${formatDate(r.period_start)} – ${formatDate(r.period_end)}</td>
              <td class="num tabular">${formatCurrency(r.given.totalValue)}<div class="text-sm muted">${pluralPt(r.given.count, 'aula', 'aulas')} · ${r.given.totalHours}h</div></td>
              <td class="num tabular">${formatCurrency(r.totalValue)}<div class="text-sm muted">${pluralPt(r.count, 'aula', 'aulas')} · ${r.totalHours}h · inclui ${formatCurrency(r.totalTransport)} de transporte</div></td></tr>`).join('')}</tbody>
        </table></div>`}
      </div>
    `;
    makeFilter(body);

    body.querySelectorAll('[data-mark]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.mark;
        const r = invoices.find(x => String(x.id) === String(id));
        btn.disabled = true;
        await api.post(`/api/payments/invoice/${id}/mark-paid`);
        offerUndo('pagar', `Pago a ${r.teacher_name}: quinzena de ${formatDate(r.period_start)} a ${formatDate(r.period_end)} (${formatCurrency(r.total_value)}).`,
          () => api.post(`/api/payments/invoice/${id}/mark-pending`));
        renderPagar(body);
      });
    });
  }

  async function renderMensais(body) {
    const rows = await api.get('/api/payments/monthly');
    const total = rows.reduce((s, r) => s + Number(r.total), 0);
    body.innerHTML = `
      ${rows.length > 0 ? searchBarHtml('Buscar aluno pelo nome…') + searchEmptyHtml('aluno') : ''}
      <div class="card pay-group">
        <div class="card-header"><h2>Pagamentos mensais</h2><span class="badge badge-pending tabular pay-group-total" data-suffix=" pendente">${formatCurrency(total)} pendente</span></div>
        <p class="text-sm muted mt-0">Alunos marcados como <strong>pagamento mensal</strong> no cadastro. Em vez de cobrar aula a aula, é uma cobrança por mês, com o <strong>total de todas as aulas do aluno naquele mês somadas</strong> (o "valor que o aluno paga" de cada aula, definido no agendamento). O mês inteiro conta, inclusive as aulas que ainda vão acontecer; aulas canceladas não entram.
          Enquanto a mensalidade estiver pendente, o total acompanha as aulas (se uma aula for adicionada, editada ou cancelada, ele muda sozinho). Depois de marcada como recebida, o valor recebido fica fixo.</p>
        ${rows.length === 0 ? `<div class="empty-state">Nenhuma mensalidade pendente.</div>` : `
        <div class="table-wrap"><table>
          <thead><tr><th>Aluno</th><th>Mês</th><th>Aulas</th><th class="num">Total do mês</th><th></th></tr></thead>
          <tbody>${rows.map((r, i) => `
            <tr class="pay-item" data-search="${escapeHtml(normalizeText(r.student_name))}" data-value="${Number(r.total) || 0}">
              <td><a href="#/alunos/${r.student_id}">${escapeHtml(r.student_name)}</a>
                <div class="text-sm muted">Aulas em: ${r.dates.join(', ')}</div>
                ${r.zeroValueCount > 0 ? `<div class="text-sm" style="color:var(--danger);">${pluralPt(r.zeroValueCount, 'aula está com valor R$ 0,00', 'aulas estão com valor R$ 0,00')} — ajuste o valor na agenda, senão a mensalidade sai menor do que deveria.</div>` : ''}</td>
              <td>${MONTH_NAMES[r.month - 1]}/${r.year}</td>
              <td>${pluralPt(r.classCount, 'aula', 'aulas')}<div class="text-sm muted">${r.doneCount} já realizada${r.doneCount === 1 ? '' : 's'}</div></td>
              <td class="num tabular">${formatCurrency(r.total)}</td>
              <td><button class="btn btn-outline btn-sm" data-mark="${i}">Marcar recebido</button></td>
            </tr>`).join('')}</tbody>
        </table></div>`}
      </div>
    `;
    makeFilter(body);

    body.querySelectorAll('[data-mark]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const r = rows[Number(btn.dataset.mark)];
        // Ao marcar como recebida o valor fica fixo; se ainda há aulas por vir no mês, avisa.
        if (r.classCount > r.doneCount) {
          const ok = await confirmModal(
            `Esta mensalidade ainda tem ${pluralPt(r.classCount - r.doneCount, 'aula por vir', 'aulas por vir')}. Se marcar como recebida agora, o valor recebido fica fixado em ${formatCurrency(r.total)} — aulas adicionadas depois não entram nele. Marcar mesmo assim?`,
            'Marcar como recebida'
          );
          if (!ok) return;
        }
        btn.disabled = true;
        await api.post(`/api/payments/monthly-charge/${r.id}/mark-paid`);
        offerUndo('mensais', `Recebido de ${r.student_name}: mensalidade de ${MONTH_NAMES[r.month - 1]}/${r.year} (${formatCurrency(r.total)}).`,
          () => api.post(`/api/payments/monthly-charge/${r.id}/mark-pending`));
        renderMensais(body);
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
        const id = btn.dataset.mark;
        const r = rows.find(x => String(x.id) === String(id));
        btn.disabled = true;
        await api.post(`/api/expenses/${id}/mark-paid`);
        offerUndo('despesas', `Despesa paga: ${r.description} (${formatCurrency(r.value)}).`,
          () => api.post(`/api/expenses/${id}/mark-pending`));
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
      const m = data.monthly;            // preenchido só para aluno de pagamento mensal
      const mesNome = MONTH_NAMES[viewMonth - 1];
      let summaryHtml;
      if (m) {
        // Mensalista: vale a mensalidade do mês (soma das aulas), não o status de cada aula.
        const c = m.charge;
        let statusBadge;
        let note = '';
        if (!c) {
          statusBadge = '<span class="badge badge-neutral">Sem cobrança registrada neste mês</span>';
        } else if (c.status === 'paid') {
          statusBadge = '<span class="badge badge-confirmed">Recebida</span>';
          if (Math.abs(Number(c.value) - Number(m.total)) > 0.005) {
            note = `<div class="text-sm" style="color:var(--danger); margin-top:6px;">Recebido: ${formatCurrency(c.value)} — mas o total atual das aulas do mês é ${formatCurrency(m.total)}. As aulas mudaram depois do pagamento.</div>`;
          }
        } else {
          statusBadge = '<span class="badge badge-pending">Pendente</span>';
        }
        const shown = c && c.status === 'paid' ? c.value : m.total;
        summaryHtml = `
          <div class="alert alert-info">
            <strong>Pagamento mensal.</strong> Mensalidade de ${mesNome}: ${formatCurrency(shown)} (${pluralPt(m.classCount, 'aula', 'aulas')}) ${statusBadge}${note}
            ${c && c.status === 'paid' ? `<div style="margin-top:8px;"><button type="button" class="btn-text text-sm" data-undo-charge="${c.id}">Voltar para pendente</button></div>` : ''}
            ${m.zeroValueCount > 0 ? `<div class="text-sm" style="color:var(--danger); margin-top:6px;">${pluralPt(m.zeroValueCount, 'aula está com valor R$ 0,00', 'aulas estão com valor R$ 0,00')}.</div>` : ''}
          </div>`;
      } else {
        const totalPending = data.classes.filter(c => !c.student_paid).reduce((sum, c) => sum + Number(c.student_value), 0);
        summaryHtml = totalPending > 0
          ? `<div class="alert alert-info">${formatCurrency(totalPending)} pendente neste mês.</div>`
          : `<div class="alert alert-info">Tudo pago neste mês. ✓</div>`;
      }

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
          ${summaryHtml}
          ${data.classes.length === 0 ? `<div class="empty-state">Nenhuma aula neste mês.</div>` : `
          <div class="table-wrap"><table>
            <thead><tr><th>Data</th><th>Disciplina</th><th>Professor</th><th class="num">Valor</th>${m ? '' : '<th>Status</th><th></th>'}</tr></thead>
            <tbody>${data.classes.map(c => `
              <tr>
                <td>${formatDate(c.start_time)}</td>
                <td>${escapeHtml(c.subject_name)}</td>
                <td>${escapeHtml(c.teacher_name)}</td>
                <td class="num tabular">${formatCurrency(c.student_value)}</td>
                ${m ? '' : `<td>${c.student_paid ? '<span class="badge badge-confirmed">Pago</span>' : '<span class="badge badge-pending">Pendente</span>'}</td>
                <td>${c.student_paid ? `<button type="button" class="btn-text text-sm" data-undo-class="${c.id}">Voltar para pendente</button>` : ''}</td>`}
              </tr>`).join('')}</tbody>
          </table></div>`}
        </div>
      `;
      detailEl.querySelectorAll('[data-undo-class]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (await undoHistoryItem('aula', btn.dataset.undoClass)) renderStudentMonth();
        });
      });
      detailEl.querySelectorAll('[data-undo-charge]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (await undoHistoryItem('mensalidade', btn.dataset.undoCharge)) renderStudentMonth();
        });
      });
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
    let histFilter = null;          // a busca da lista geral (a caixa fica fora da lista, que é redesenhada)

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
          ${searchBarHtml('Buscar por nome (aluno, professor ou despesa)…')}
          ${searchEmptyHtml('registro', true)}
          <div id="hist-cat-body"><div class="loading-dots">Carregando…</div></div>
        </div>
      `;
      histFilter = makeFilter(generalEl, '#hist-cat-body .pay-item');
      document.querySelectorAll('#hist-cat-toggle button').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#hist-cat-toggle button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          generalCategory = btn.dataset.cat;
          searchQuery = '';
          const si = generalEl.querySelector('#pay-search');
          if (si) si.value = '';
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
        if (histFilter) histFilter.apply();
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
      const referenceLabel = { alunos: 'Data da aula / mês', professores: 'Início da quinzena', despesas: 'Vencimento' }[generalCategory];
      const nameLabel = { alunos: 'Aluno', professores: 'Professor', despesas: 'Descrição' }[generalCategory];

      catBody.innerHTML = sortedKeys.map(key => {
        const items = groups.get(key);
        const subtotal = items.reduce((s, r) => s + Number(r.value), 0);
        const [y, m] = key.split('-');
        const label = (y && m) ? `${MONTH_NAMES[Number(m) - 1]} de ${y}` : 'Sem data de pagamento';
        return `
          <div class="pay-group">
          <div class="day-section-title" style="display:flex; justify-content:space-between; align-items:center;">
            <span>${label}</span><span class="tabular pay-group-total" data-suffix="">${formatCurrency(subtotal)}</span>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>${nameLabel}</th><th>${referenceLabel}</th><th class="num">Valor</th><th>Pago/recebido em</th><th></th></tr></thead>
            <tbody>${items.map(r => `
              <tr class="pay-item" data-search="${escapeHtml(normalizeText(r.name))}" data-value="${Number(r.value) || 0}">
                <td>${escapeHtml(r.name)}</td>
                <td>${escapeHtml(String(r.reference_date || '').slice(0, 10))}</td>
                <td class="num tabular">${formatCurrency(r.value)}</td>
                <td>${r.paid_at ? formatDateTime(r.paid_at) : '—'}</td>
                <td class="flex gap-10">
                  <button class="btn-text text-sm" data-undo-hist="${r.id}" data-type="${r.type}">Voltar para pendente</button>
                  <button class="btn-text text-sm" data-del-hist="${r.id}" data-type="${r.type}">Excluir</button>
                </td>
              </tr>`).join('')}</tbody>
          </table></div>
          </div>
        `;
      }).join('');

      catBody.querySelectorAll('[data-undo-hist]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const undone = await undoHistoryItem(btn.dataset.type, btn.dataset.undoHist);
          if (undone) renderCategoryBody();
        });
      });
      catBody.querySelectorAll('[data-del-hist]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const deleted = await deleteHistoryItem(btn.dataset.type, btn.dataset.delHist);
          if (deleted) renderCategoryBody();
        });
      });
      if (histFilter) histFilter.apply();
    }

    renderGeneral();
  }

  renderTab();
};
