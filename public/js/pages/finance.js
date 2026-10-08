// public/js/pages/finance.js

window.Pages = window.Pages || {};

// Mês que está sendo visto. Fica guardado enquanto o painel estiver aberto: ir para Pagamentos e voltar mantém
// o mesmo mês. Na primeira vez (ou depois de recarregar a página), é o mês atual.
let financeSelected = null; // { year, month }

Pages.finance = async function (root) {
  const today = new Date();
  const current = { year: today.getFullYear(), month: today.getMonth() + 1 };
  const MIN_YEAR = current.year - 5; // limites da navegação: 5 anos para trás, 3 para frente
  const MAX_YEAR = current.year + 3;
  let selected = financeSelected || current;
  let rangeMonths = 6;
  let loadSeq = 0; // se a pessoa trocar de mês depressa, só vale a resposta mais recente

  const idx = (ym) => ym.year * 12 + (ym.month - 1);
  const fromIdx = (i) => ({ year: Math.floor(i / 12), month: (i % 12) + 1 });
  const shift = (ym, d) => fromIdx(idx(ym) + d);
  const inRange = (ym) => ym.year >= MIN_YEAR && ym.year <= MAX_YEAR;
  const labelOf = (ym) => `${MONTH_NAMES[ym.month - 1]} de ${ym.year}`;
  const keyOf = (ym) => `${ym.year}-${String(ym.month).padStart(2, '0')}`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const relationOf = (ym) => (idx(ym) === idx(current) ? 'current' : (idx(ym) < idx(current) ? 'past' : 'future'));
  if (!inRange(selected)) selected = current;

  const yearOptions = [];
  for (let y = MIN_YEAR; y <= MAX_YEAR; y++) yearOptions.push(`<option value="${y}">${y}</option>`);

  root.innerHTML = `
    <div class="page-header">
      <div><div class="eyebrow">Financeiro</div><h1>Faturamento e lucro</h1>
        <p class="subtitle">Visão geral do negócio — receita, custos e lucro ao longo do tempo. Cada valor conta no mês em que foi efetivamente pago ou recebido (não no mês da aula ou do vencimento) — então o que ainda está pendente aparece em Pagamentos, não aqui. Escolha o mês abaixo: nos meses que ainda não chegaram, a tela mostra a previsão pela agenda.</p></div>
    </div>
    <div class="calendar-toolbar fin-month-bar">
      <div class="calendar-nav">
        <button type="button" class="btn btn-outline btn-sm" id="fin-prev" aria-label="Mês anterior">&larr;</button>
        <select id="fin-month" class="fin-select" aria-label="Mês">${MONTH_NAMES.map((n, i) => `<option value="${i + 1}">${n}</option>`).join('')}</select>
        <select id="fin-year" class="fin-select" aria-label="Ano">${yearOptions.join('')}</select>
        <button type="button" class="btn btn-outline btn-sm" id="fin-next" aria-label="Próximo mês">&rarr;</button>
      </div>
      <div class="flex gap-10" style="align-items:center;">
        <span class="badge" id="fin-relation"></span>
        <button type="button" class="btn btn-outline btn-sm" id="fin-today">Mês atual</button>
      </div>
    </div>
    <div class="day-section-title" id="fin-realized-title" style="margin-top:0;"></div>
    <div class="stat-grid" id="finance-stats"><div class="loading-dots">Carregando…</div></div>
    <div class="card" id="finance-forecast"><div class="loading-dots">Carregando…</div></div>
    <div class="card card-ruled">
      <div class="card-header"><h2>Evolução mês a mês</h2>
        <div class="pill-toggle" id="finance-range">
          <button type="button" data-months="6" class="active">6 meses</button>
          <button type="button" data-months="12">12 meses</button>
        </div>
      </div>
      <p class="text-sm muted mt-0">Clique em um mês do gráfico para ver os números dele. O mês escolhido fica destacado.</p>
      <div id="finance-chart"><div class="loading-dots">Carregando…</div></div>
    </div>
    <div class="field-row">
      <div class="card">
        <div class="card-header"><h2 id="breakdown-subject-title">Faturamento por disciplina</h2></div>
        <p class="text-sm muted mt-0" id="breakdown-month-label"></p>
        <div id="breakdown-subject"></div>
      </div>
      <div class="card">
        <div class="card-header"><h2 id="breakdown-teacher-title">Custo por professor</h2></div>
        <p class="text-sm muted mt-0" id="breakdown-teacher-label">Aulas + transporte, no mesmo período.</p>
        <div id="breakdown-teacher"></div>
      </div>
    </div>
  `;

  // ---------- seletor de mês ----------
  function syncControls() {
    const rel = relationOf(selected);
    document.getElementById('fin-month').value = String(selected.month);
    document.getElementById('fin-year').value = String(selected.year);
    document.getElementById('fin-prev').disabled = !inRange(shift(selected, -1));
    document.getElementById('fin-next').disabled = !inRange(shift(selected, 1));
    document.getElementById('fin-today').disabled = rel === 'current';
    const badge = document.getElementById('fin-relation');
    badge.className = 'badge ' + { current: 'badge-confirmed', past: 'badge-neutral', future: 'badge-pending' }[rel];
    badge.textContent = { current: 'Mês atual', past: 'Mês passado', future: 'Mês futuro' }[rel];
  }

  function go(ym) {
    if (!inRange(ym)) return;
    selected = ym;
    financeSelected = ym;
    syncControls();
    loadAll();
  }

  document.getElementById('fin-prev').addEventListener('click', () => go(shift(selected, -1)));
  document.getElementById('fin-next').addEventListener('click', () => go(shift(selected, 1)));
  document.getElementById('fin-today').addEventListener('click', () => go(current));
  const onPick = () => go({ year: Number(document.getElementById('fin-year').value), month: Number(document.getElementById('fin-month').value) });
  document.getElementById('fin-month').addEventListener('change', onPick);
  document.getElementById('fin-year').addEventListener('change', onPick);

  // ---------- blocos da tela ----------
  async function loadRealized(seq) {
    const rel = relationOf(selected);
    const statsEl = document.getElementById('finance-stats');
    document.getElementById('fin-realized-title').textContent =
      rel === 'current' ? 'Já realizado neste mês (pago/recebido)' : `Realizado em ${labelOf(selected)} (pago/recebido)`;
    const futureNote = `<div class="alert alert-info" style="grid-column:1 / -1; margin:0;">${labelOf(selected)} ainda não chegou: nada foi pago ou recebido nele (cada valor conta no mês em que é efetivamente pago). Veja a previsão logo abaixo.</div>`;
    if (rel === 'future') { statsEl.innerHTML = futureNote; return; }

    statsEl.innerHTML = '<div class="loading-dots">Carregando…</div>';
    const series = await api.get(`/api/finance/monthly?months=1&end=${keyOf(selected)}`);
    if (seq !== loadSeq) return;
    const m = series[series.length - 1];
    if (m.projected) { statsEl.innerHTML = futureNote; return; }
    const margin = m.revenue > 0 ? (m.profit / m.revenue * 100) : 0;
    const isNow = !!m.isCurrent;
    statsEl.innerHTML = `
      <div class="stat-card"><div class="stat-label">${isNow ? 'Receita do mês (até agora)' : 'Receita do mês'}</div><div class="stat-value accent tabular">${formatCurrency(m.revenue)}</div></div>
      <div class="stat-card"><div class="stat-label">Custos do mês</div><div class="stat-value danger tabular">${formatCurrency(m.totalCosts)}</div>
        <div class="text-sm muted">${formatCurrency(m.teacherCosts)} professores · ${formatCurrency(m.expenseCosts)} despesas</div></div>
      <div class="stat-card"><div class="stat-label">Lucro do mês</div><div class="stat-value ${m.profit >= 0 ? 'confirmed' : 'danger'} tabular">${formatCurrency(m.profit)}</div></div>
      <div class="stat-card"><div class="stat-label">Margem</div><div class="stat-value ${margin >= 0 ? 'confirmed' : 'danger'} tabular">${margin.toFixed(1)}%</div></div>
    `;
  }

  async function loadForecast(seq) {
    const el = document.getElementById('finance-forecast');
    const f = await api.get(`/api/finance/forecast?year=${selected.year}&month=${selected.month}`);
    if (seq !== loadSeq) return;
    const mes = MONTH_NAMES[f.month - 1];
    const past = !!f.isPast;
    const future = !!f.isFuture;
    const zeroed = f.monthlyZeroValueClasses;
    const adj = past ? { rev: 'Receita agendada', cost: 'Custos agendados', profit: 'Lucro agendado', margin: 'Margem agendada' }
      : { rev: 'Receita prevista', cost: 'Custos previstos', profit: 'Lucro previsto', margin: 'Margem prevista' };
    const title = past ? `Agenda de ${mes}` : `Previsão de ${mes}`;
    const intro = past
      ? 'O que estava na agenda do mês: soma de todas as aulas agendadas, mais as mensalidades e as despesas do mês, tenham sido pagas ou não. Compare com o realizado acima — a diferença é o que foi pago ou recebido em outro mês, ou ainda está pendente.'
      : future
        ? 'Quanto o mês deve fechar se tudo que está agendado acontecer e for pago: soma todas as aulas já agendadas no mês, mais as mensalidades e as despesas. As contas fixas recorrentes, que o sistema só gera quando o mês chega, entram como previstas. Muda conforme você agenda ou cancela aulas. É uma projeção — nada disso foi pago ainda.'
        : 'Quanto o mês deve fechar se tudo que está agendado acontecer e for pago: soma todas as aulas agendadas no mês (as que já aconteceram e as que ainda vão acontecer), mais as mensalidades e as despesas do mês. É uma projeção — diferente dos números acima, que só contam o que já foi efetivamente pago ou recebido.';
    const countLine = f.classCount === 0
      ? `Nenhuma aula agendada em ${mes}.`
      : past ? `${plural(f.classCount, 'aula', 'aulas')} em ${mes}.`
        : future ? `${plural(f.classCount, 'aula agendada', 'aulas agendadas')} em ${mes}, todas ainda por vir.`
          : `${plural(f.classCount, 'aula agendada', 'aulas agendadas')} em ${mes}: ${plural(f.doneCount, 'já realizada', 'já realizadas')} e ${f.upcomingCount} ainda por vir.`;
    el.innerHTML = `
      <div class="card-header"><h2>${title}</h2></div>
      <p class="text-sm muted mt-0">${intro}</p>
      <div class="stat-grid" style="margin-bottom:12px;">
        <div class="stat-card"><div class="stat-label">${adj.rev}</div><div class="stat-value accent tabular">${formatCurrency(f.revenue)}</div>
          <div class="text-sm muted">${formatCurrency(f.classRevenue)} em aulas · ${formatCurrency(f.monthlyRevenue)} em mensalidades</div></div>
        <div class="stat-card"><div class="stat-label">${adj.cost}</div><div class="stat-value danger tabular">${formatCurrency(f.totalCosts)}</div>
          <div class="text-sm muted">${formatCurrency(f.teacherCosts)} professores · ${formatCurrency(f.expenseCosts)} despesas</div>
          ${f.recurringExpenseProjected > 0 ? `<div class="text-sm muted">As despesas incluem ${formatCurrency(f.recurringExpenseProjected)} de contas recorrentes previstas.</div>` : ''}</div>
        <div class="stat-card"><div class="stat-label">${adj.profit}</div><div class="stat-value ${f.profit >= 0 ? 'confirmed' : 'danger'} tabular">${formatCurrency(f.profit)}</div></div>
        <div class="stat-card"><div class="stat-label">${adj.margin}</div><div class="stat-value ${f.margin >= 0 ? 'confirmed' : 'danger'} tabular">${f.margin.toFixed(1)}%</div></div>
      </div>
      <p class="text-sm muted" style="margin:0;">${countLine}</p>
      ${zeroed > 0 ? `<div class="alert alert-info" style="margin:12px 0 0 0;">${plural(zeroed, 'aula de aluno de pagamento mensal está', 'aulas de alunos de pagamento mensal estão')} com valor R$ 0,00, então a receita ${past ? 'agendada' : 'prevista'} está menor do que ${past ? 'deveria' : 'vai ser'}. Ajuste o valor dessas aulas na agenda.</div>` : ''}
    `;
  }

  // Onde a janela do gráfico termina: no mês escolhido se for futuro; a janela de sempre (terminando no mês atual)
  // se o mês escolhido estiver dentro dela; e, para um mês bem antigo, traz o mês escolhido para o meio.
  function chartEnd() {
    const s = idx(selected);
    const c = idx(current);
    if (s > c) return selected;
    if (s >= c - (rangeMonths - 1)) return current;
    return fromIdx(Math.min(c, s + Math.floor(rangeMonths / 2)));
  }

  async function loadChart(seq) {
    const chartEl = document.getElementById('finance-chart');
    const series = await api.get(`/api/finance/monthly?months=${rangeMonths}&end=${keyOf(chartEnd())}`);
    if (seq !== undefined && seq !== loadSeq) return;
    FinanceChart.renderBarChart(chartEl, series, { selected, onSelect: (year, month) => go({ year, month }) });
  }

  async function loadBreakdown(seq) {
    const bd = await api.get(`/api/finance/breakdown?year=${selected.year}&month=${selected.month}`);
    if (seq !== loadSeq) return;
    const rel = relationOf(selected);
    const projected = !!bd.projected;
    document.getElementById('breakdown-subject-title').textContent = projected ? 'Faturamento previsto por disciplina' : 'Faturamento por disciplina';
    document.getElementById('breakdown-teacher-title').textContent = projected ? 'Custo previsto por professor' : 'Custo por professor';
    document.getElementById('breakdown-month-label').textContent =
      projected ? `${labelOf(selected)}, previsto pela agenda` : (rel === 'current' ? `${labelOf(selected)}, até agora` : labelOf(selected));
    document.getElementById('breakdown-teacher-label').textContent =
      projected ? 'Aulas + transporte das aulas agendadas no mês.' : 'Aulas + transporte, no mesmo período.';
    const emptyText = projected ? 'Nenhuma aula agendada neste mês.' : (rel === 'current' ? 'Nenhuma aula registrada ainda este mês.' : 'Nada foi pago ou recebido neste mês.');
    FinanceChart.renderRankList(document.getElementById('breakdown-subject'), bd.bySubject, { color: 'var(--accent)', emptyText });
    FinanceChart.renderRankList(document.getElementById('breakdown-teacher'), bd.byTeacher, { color: 'var(--danger)', emptyText });
  }

  function loadAll() {
    const seq = ++loadSeq;
    return Promise.allSettled([loadRealized(seq), loadForecast(seq), loadChart(seq), loadBreakdown(seq)]);
  }

  document.querySelectorAll('#finance-range button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#finance-range button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      rangeMonths = Number(btn.dataset.months);
      document.getElementById('finance-chart').innerHTML = '<div class="loading-dots">Carregando…</div>';
      loadChart(loadSeq);
    });
  });

  syncControls();
  await loadAll();
};
