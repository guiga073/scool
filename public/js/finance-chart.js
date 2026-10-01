// public/js/finance-chart.js
// Gráfico de barras em SVG puro (sem biblioteca externa) para receita/custo/lucro
// por mês. Separado em math (testável isoladamente) + montagem do SVG.

const FinanceChartMath = {
  // values: lista plana de números (pode ter negativos, por causa do lucro).
  // Devolve uma função toY(valor) -> posição em pixels dentro da área de plotagem,
  // sempre incluindo o zero no intervalo (para o lucro negativo "afundar" corretamente).
  yScale(values, plotHeight) {
    const maxVal = Math.max(0, ...values);
    const minVal = Math.min(0, ...values);
    const range = (maxVal - minVal) || 1;
    const toY = (value) => plotHeight - ((value - minVal) / range) * plotHeight;
    return { maxVal, minVal, range, toY, zeroY: toY(0) };
  },

  // Retângulo (y, altura) de uma barra representando `value`, dado toY e a posição do zero.
  barRect(value, toY, zeroY) {
    const y1 = toY(value);
    const top = Math.min(y1, zeroY);
    const height = Math.abs(y1 - zeroY);
    return { top, height };
  },
};

const FinanceChart = {
  renderBarChart(container, series) {
    const W = 760, H = 320;
    const marginLeft = 56, marginRight = 16, marginTop = 16, marginBottom = 32;
    const plotW = W - marginLeft - marginRight;
    const plotH = H - marginTop - marginBottom;

    const allValues = series.flatMap(m => [m.revenue, m.totalCosts, m.profit]);
    const { toY, zeroY, maxVal, minVal } = FinanceChartMath.yScale(allValues, plotH);

    const slotW = plotW / series.length;
    const barW = Math.min(20, slotW / 5);
    const gap = 4;

    const colors = { revenue: 'var(--accent)', cost: 'var(--danger)', profit: 'var(--confirmed)' };

    let bars = '';
    let labels = '';
    series.forEach((m, i) => {
      const slotX = marginLeft + i * slotW;
      const groupW = barW * 3 + gap * 2;
      const groupX = slotX + (slotW - groupW) / 2;

      [['revenue', m.revenue, colors.revenue], ['totalCosts', m.totalCosts, colors.cost], ['profit', m.profit, colors.profit]]
        .forEach(([key, value, color], bi) => {
          const { top, height } = FinanceChartMath.barRect(value, toY, zeroY);
          const x = groupX + bi * (barW + gap);
          bars += `<rect x="${x.toFixed(1)}" y="${(marginTop + top).toFixed(1)}" width="${barW}" height="${Math.max(height, 0.5).toFixed(1)}" rx="2" fill="${color}"><title>${MONTH_NAMES[m.month - 1]}/${m.year} — ${key}: ${formatCurrency(value)}</title></rect>`;
        });

      labels += `<text x="${(slotX + slotW / 2).toFixed(1)}" y="${H - 10}" font-size="10.5" text-anchor="middle" fill="var(--ink-soft)">${MONTH_NAMES[m.month - 1].slice(0, 3)}</text>`;
    });

    const zeroLineY = marginTop + zeroY;
    const svg = `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; font-family:var(--font-body);">
        <line x1="${marginLeft}" y1="${zeroLineY.toFixed(1)}" x2="${W - marginRight}" y2="${zeroLineY.toFixed(1)}" stroke="var(--border-strong)" stroke-width="1"/>
        <text x="${marginLeft - 8}" y="${marginTop + 4}" font-size="10" text-anchor="end" fill="var(--ink-faint)">${formatCurrency(maxVal)}</text>
        <text x="${marginLeft - 8}" y="${zeroLineY.toFixed(1)}" font-size="10" text-anchor="end" fill="var(--ink-faint)">R$ 0</text>
        ${minVal < 0 ? `<text x="${marginLeft - 8}" y="${marginTop + plotH}" font-size="10" text-anchor="end" fill="var(--ink-faint)">${formatCurrency(minVal)}</text>` : ''}
        ${bars}
        ${labels}
      </svg>
    `;
    container.innerHTML = `
      <div>${svg}</div>
      <div class="flex gap-14" style="margin-top:10px; justify-content:center;">
        <span class="text-sm"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--accent);margin-right:5px;"></span>Receita</span>
        <span class="text-sm"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--danger);margin-right:5px;"></span>Custos</span>
        <span class="text-sm"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--confirmed);margin-right:5px;"></span>Lucro</span>
      </div>
    `;
  },

  // Lista horizontal simples (barra de progresso) para os breakdowns por disciplina/professor.
  renderRankList(container, items, opts) {
    if (items.length === 0) {
      container.innerHTML = `<div class="empty-state text-sm" style="padding:16px;">${(opts && opts.emptyText) || 'Nada neste período.'}</div>`;
      return;
    }
    const max = Math.max(...items.map(i => i.value));
    container.innerHTML = items.map(i => `
      <div style="margin-bottom:10px;">
        <div class="flex-between text-sm" style="margin-bottom:3px;">
          <span>${escapeHtml(i.label)}</span><span class="tabular" style="font-weight:600;">${formatCurrency(i.value)}</span>
        </div>
        <div style="background:var(--surface-sunken); border-radius:100px; height:7px; overflow:hidden;">
          <div style="background:${(opts && opts.color) || 'var(--accent)'}; height:100%; width:${max > 0 ? (i.value / max * 100) : 0}%;"></div>
        </div>
      </div>
    `).join('');
  },
};
