// public/js/pages/dashboard.js

window.Pages = window.Pages || {};

Pages.dashboard = async function (root) {
  const now = new Date();
  const todayStart = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} 00:00:00`;
  const todayEnd = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} 23:59:59`;

  const [students, teachers, todayClasses, receivable, monthly, payable] = await Promise.all([
    api.get('/api/students'),
    api.get('/api/teachers'),
    api.get(`/api/classes?start=${encodeURIComponent(todayStart)}&end=${encodeURIComponent(todayEnd)}`),
    api.get('/api/payments/receivable'),
    api.get('/api/payments/monthly'),
    api.get('/api/payments/payable'),
  ]);

  // A receber agora = aulas avulsas que JÁ aconteceram e não foram pagas + mensalidades pendentes.
  const totalReceivable = receivable.filter(c => c.happened).reduce((s, c) => s + Number(c.student_value), 0) + monthly.reduce((s, c) => s + Number(c.total), 0);
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

    <div id="wa-attention"></div>
    <div id="materials-space-alert"></div>

    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Alunos ativos</div><div class="stat-value">${students.length}</div></div>
      <div class="stat-card"><div class="stat-label">Professores ativos</div><div class="stat-value">${teachers.length}</div></div>
      <div class="stat-card"><div class="stat-label">A receber (pendente)</div><div class="stat-value accent tabular">${formatCurrency(totalReceivable)}</div><div class="text-sm muted">aulas avulsas já realizadas + mensalidades</div></div>
      <div class="stat-card"><div class="stat-label">A pagar a professores</div><div class="stat-value danger tabular">${formatCurrency(totalPayable)}</div></div>
    </div>

    <div class="card card-ruled">
      <div class="card-header"><h2>Aulas de hoje</h2>
        <a href="#/agendamento" class="btn btn-outline btn-sm">Ver agenda completa</a></div>
      ${todayClasses.length === 0 ? `<div class="empty-state"><div class="eyebrow">Nada por aqui</div>Nenhuma aula agendada para hoje.</div>` : `
      <div class="time-slot-list">
        ${todayClasses.map(c => `
          <div class="slot${isCancelRequest(c) ? ' cancel-req' : ''}" data-class-id="${c.id}">
            <span class="time">${formatTime(c.start_time)}–${formatTime(c.end_time)}</span>
            <span class="grow">${escapeHtml(c.student_name)} · ${escapeHtml(c.subject_name)} <span class="muted">com ${escapeHtml(c.teacher_name)}</span>${slotConfirmHtml(c)}</span>
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

  // Aula de hoje: clicar abre o detalhe (confirmação, contato do responsável, cancelar...).
  root.querySelectorAll('.slot[data-class-id]').forEach((el) => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      const cls = todayClasses.find((c) => String(c.id) === el.dataset.classId);
      if (cls) openClassDetailModal(cls, () => Pages.dashboard(root));
    });
  });

  // Avisos da confirmação por WhatsApp: pedidos de cancelamento em aberto (vermelho) e avisos que não saíram (amarelo).
  api.get('/api/whatsapp/attention').then((att) => {
    const slot = document.getElementById('wa-attention');
    if (!slot) return;
    const rows = (list, extra) => list.map((c) => `
      <div class="slot${isCancelRequest(c) ? ' cancel-req' : ''}" data-attn-id="${c.id}">
        <span class="time">${formatDate(c.start_time)}<br>${formatTime(c.start_time)}</span>
        <span class="grow"><strong>${escapeHtml(c.student_name)}</strong> · ${escapeHtml(c.subject_name)} <span class="muted">com ${escapeHtml(c.teacher_name)}</span>
          <div class="text-sm muted">${extra(c)}</div></span>
        <button type="button" class="btn btn-outline btn-sm" data-open-class="${c.id}">Abrir</button>
      </div>`).join('');
    const contact = (c) => {
      const toStudent = c.confirmer === 'aluno';
      const phone = toStudent ? c.student_phone : c.guardian_phone;
      const name = toStudent ? c.student_name : c.guardian_name;
      const link = whatsappLink(phone);
      return `${toStudent ? 'Aluno' : 'Responsável'}${name ? ': ' + escapeHtml(name) : ''}` +
        `${phone ? ' · ' + (link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(phone)}</a>` : escapeHtml(phone)) : ' · sem telefone'}`;
    };
    let html = '';
    if (att.cancelRequests.length > 0) {
      html += `
        <div class="card card-alert" id="wa-cancel-card">
          <div class="card-header"><h2>⚠️ Pedidos de cancelamento (${att.cancelRequests.length})</h2></div>
          <p class="text-sm" style="margin:0 0 10px;">O responsável (ou o aluno) respondeu <strong>Não</strong> no WhatsApp. Entre em contato para ver a situação: a aula continua valendo nas contas e nas estatísticas até você <strong>excluí-la</strong> ou mudar o status dela.</p>
          <div class="time-slot-list">${rows(att.cancelRequests, (c) => `${contact(c)}${c.confirmation_updated_at ? ' · pedido em ' + escapeHtml(formatDateTime(c.confirmation_updated_at)) : ''}`)}</div>
        </div>`;
    }
    if (att.sendProblems.length > 0) {
      html += `
        <div class="card" id="wa-problem-card">
          <div class="card-header"><h2>Avisos de confirmação que não saíram (${att.sendProblems.length})</h2>
            <a href="#/whatsapp" class="btn btn-outline btn-sm">Ver página WhatsApp</a></div>
          <div class="time-slot-list">${rows(att.sendProblems, (c) => `<span class="confirm-error">${escapeHtml(c.confirm_error)}</span>`)}</div>
        </div>`;
    }
    slot.innerHTML = html;
    const all = att.cancelRequests.concat(att.sendProblems);
    slot.querySelectorAll('[data-open-class]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cls = all.find((c) => String(c.id) === btn.dataset.openClass);
        if (cls) openClassDetailModal(cls, () => Pages.dashboard(root));
      });
    });
  }).catch(() => {});

  // Aviso quando o espaço dos materiais está acabando. Não atrapalha o painel se der qualquer erro.
  api.get('/api/admin/materials?limit=1').then(({ usage }) => {
    const limit = usage.limitBytes !== undefined ? usage.limitBytes : usage.capBytes;
    const pct = usage.remainingBytes <= 0 ? 100 : (limit ? (usage.usedBytes / limit) * 100 : 0);
    const slot = document.getElementById('materials-space-alert');
    if (!slot || pct < 80) return;
    slot.innerHTML = `
      <div class="alert ${pct >= 95 ? 'alert-danger' : 'alert-warn'}">
        <div>O espaço de <strong>materiais</strong> está em ${Math.round(pct)}% (${escapeHtml(formatBytes(usage.usedBytes))} de ${escapeHtml(formatBytes(limit))}).
        Quando encher, ninguém consegue enviar novos arquivos. <a href="#/materiais">Ver materiais</a></div>
      </div>`;
  }).catch(() => {});
};
