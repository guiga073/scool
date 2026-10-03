// public/js/pages/finance.js

window.Pages = window.Pages || {};

Pages.finance = async function (root) {
  root.innerHTML = `
    <div class="page-header">
      <div><div class="eyebrow">Financeiro</div><h1>Faturamento e lucro</h1>
        <p class="subtitle">Visão geral do negócio — receita, custos e lucro ao longo do tempo. Cada valor conta no mês em que foi efetivamente pago ou recebido (não no mês da aula ou do vencimento) — então o que ainda está pendente aparece em Pagamentos, não aqui.</p></div>
    </div>
    <div class="stat-grid" id="finance-stats"><div class="loading-dots">Carregando…</div></div>
    <div class="card card-ruled">
      <div class="card-header"><h2>Últimos meses</h2>
        <div class="pill-toggle" id="finance-range">
          <button type="button" data-months="6" class="active">6 meses</button>
          <button type="button" data-months="12">12 meses</button>
        </div>
      </div>
      <div id="finance-chart"><div class="loading-dots">Carregando…</div></div>
    </div>
    <div class="field-row">
      <div class="card">
        <div class="card-header"><h2>Faturamento por disciplina</h2></div>
        <p class="text-sm muted mt-0" id="breakdown-month-label"></p>
        <div id="breakdown-subject"></div>
      </div>
      <div class="card">
        <div class="card-header"><h2>Custo por professor</h2></div>
        <p class="text-sm muted mt-0">Aulas + transporte, no mesmo período.</p>
        <div id="breakdown-teacher"></div>
      </div>
    </div>
  `;

  async function loadStats() {
    const series = await api.get('/api/finance/monthly?months=1');
    const current = series[series.length - 1];
    const margin = current.revenue > 0 ? (current.profit / current.revenue * 100) : 0;
    document.getElementById('finance-stats').innerHTML = `
      <div class="stat-card"><div class="stat-label">Receita do mês (até agora)</div><div class="stat-value accent tabular">${formatCurrency(current.revenue)}</div></div>
      <div class="stat-card"><div class="stat-label">Custos do mês</div><div class="stat-value danger tabular">${formatCurrency(current.totalCosts)}</div>
        <div class="text-sm muted">${formatCurrency(current.teacherCosts)} professores · ${formatCurrency(current.expenseCosts)} despesas</div></div>
      <div class="stat-card"><div class="stat-label">Lucro do mês</div><div class="stat-value ${current.profit >= 0 ? 'confirmed' : 'danger'} tabular">${formatCurrency(current.profit)}</div></div>
      <div class="stat-card"><div class="stat-label">Margem</div><div class="stat-value ${margin >= 0 ? 'confirmed' : 'danger'} tabular">${margin.toFixed(1)}%</div></div>
    `;
  }

  async function loadChart(months) {
    const chartEl = document.getElementById('finance-chart');
    chartEl.innerHTML = '<div class="loading-dots">Carregando…</div>';
    const series = await api.get(`/api/finance/monthly?months=${months}`);
    FinanceChart.renderBarChart(chartEl, series);
  }

  async function loadBreakdown() {
    const now = new Date();
    document.getElementById('breakdown-month-label').textContent = `${MONTH_NAMES[now.getMonth()]} de ${now.getFullYear()}, até agora`;
    const { bySubject, byTeacher } = await api.get('/api/finance/breakdown');
    FinanceChart.renderRankList(document.getElementById('breakdown-subject'), bySubject, { color: 'var(--accent)', emptyText: 'Nenhuma aula registrada ainda este mês.' });
    FinanceChart.renderRankList(document.getElementById('breakdown-teacher'), byTeacher, { color: 'var(--danger)', emptyText: 'Nenhuma aula registrada ainda este mês.' });
  }

  document.querySelectorAll('#finance-range button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#finance-range button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadChart(Number(btn.dataset.months));
    });
  });

  await Promise.all([loadStats(), loadChart(6), loadBreakdown()]);
};
