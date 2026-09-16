// public/js/pages/teachers.js

window.Pages = window.Pages || {};

async function teacherFormModal(existing, onSaved) {
  const t = existing || {};
  const allSubjects = await api.get('/api/subjects');
  const selectedIds = new Set((t.subjects || []).map(s => s.id));

  const html = `
    <div class="modal-header"><h3>${existing ? 'Editar professor' : 'Novo professor'}</h3>
      <button class="modal-close" id="tf-close">&times;</button></div>
    <form id="teacher-form">
      <div class="field"><label for="tf-name">Nome do professor</label>
        <input type="text" id="tf-name" value="${escapeHtml(t.name || '')}" required></div>
      <div class="field-row">
        <div class="field"><label for="tf-phone">Telefone</label>
          <input type="tel" id="tf-phone" value="${escapeHtml(t.phone || '')}"></div>
        <div class="field"><label for="tf-pix">Chave PIX</label>
          <input type="text" id="tf-pix" value="${escapeHtml(t.pix || '')}"></div>
      </div>
      <div class="field"><label for="tf-address">Endereço</label>
        <input type="text" id="tf-address" value="${escapeHtml(t.address || '')}"></div>
      <div class="field"><label>Disciplinas que leciona</label>
        <div class="pill-toggle" id="tf-subjects">
          ${allSubjects.map(s => `<button type="button" data-id="${s.id}" class="${selectedIds.has(s.id) ? 'active' : ''}">${escapeHtml(s.name)}</button>`).join('')}
        </div>
        <div class="hint">Só professores marcados numa disciplina aparecem como opção ao agendar uma aula daquela disciplina.</div>
      </div>
      <div class="field"><label for="tf-availability">Disponibilidade (informativo)</label>
        <textarea id="tf-availability" placeholder="Ex.: Segunda e quarta, 14h–18h">${escapeHtml(t.availability || '')}</textarea>
        <div class="hint">Isso é só uma anotação — não bloqueia nem avisa sobre conflitos no agendamento.</div>
      </div>
      <div id="tf-error" class="alert alert-danger hidden"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" id="tf-cancel">Cancelar</button>
        <button type="submit" class="btn btn-primary">${existing ? 'Salvar alterações' : 'Cadastrar professor'}</button>
      </div>
    </form>
  `;
  const backdrop = openModal(html);
  backdrop.querySelector('#tf-close').onclick = closeModal;
  backdrop.querySelector('#tf-cancel').onclick = closeModal;
  backdrop.querySelectorAll('#tf-subjects button').forEach(btn => {
    btn.addEventListener('click', () => {
      const idNum = Number(btn.dataset.id);
      if (selectedIds.has(idNum)) { selectedIds.delete(idNum); btn.classList.remove('active'); }
      else { selectedIds.add(idNum); btn.classList.add('active'); }
    });
  });

  backdrop.querySelector('#teacher-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = backdrop.querySelector('#tf-error');
    errEl.classList.add('hidden');
    const payload = {
      name: backdrop.querySelector('#tf-name').value.trim(),
      phone: backdrop.querySelector('#tf-phone').value.trim(),
      pix: backdrop.querySelector('#tf-pix').value.trim(),
      address: backdrop.querySelector('#tf-address').value.trim(),
      availability: backdrop.querySelector('#tf-availability').value.trim(),
      subject_ids: Array.from(selectedIds),
    };
    try {
      const saved = existing ? await api.put(`/api/teachers/${existing.id}`, payload) : await api.post('/api/teachers', payload);
      closeModal();
      showToast(existing ? 'Professor atualizado.' : 'Professor cadastrado.');
      onSaved(saved);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });
}

Pages.teachersList = async function (root) {
  root.innerHTML = `
    <div class="page-header">
      <div><div class="eyebrow">Cadastro</div><h1>Professores</h1>
        <p class="subtitle">Cadastre professores, suas disciplinas e disponibilidade.</p></div>
      <button class="btn btn-accent" id="add-teacher-btn">+ Cadastrar professor</button>
    </div>
    <div class="card" id="teacher-list-wrap"><div class="loading-dots">Carregando…</div></div>
  `;
  document.getElementById('add-teacher-btn').addEventListener('click', () => {
    teacherFormModal(null, (created) => { location.hash = `#/professores/${created.id}`; });
  });

  const teachers = await api.get('/api/teachers');
  const wrap = document.getElementById('teacher-list-wrap');
  if (teachers.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><div class="eyebrow">Nenhum professor</div>Cadastre o primeiro professor para começar.</div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Nome</th><th>Disciplinas</th><th>Telefone</th><th>PIX</th></tr></thead>
      <tbody>
        ${teachers.map(t => `
          <tr class="row-link" data-id="${t.id}">
            <td><strong>${escapeHtml(t.name)}</strong></td>
            <td>${t.subjects.map(s => `<span class="badge badge-neutral" style="margin-right:3px;">${escapeHtml(s.name)}</span>`).join('') || '<span class="muted text-sm">—</span>'}</td>
            <td>${escapeHtml(t.phone || '—')}</td>
            <td>${escapeHtml(t.pix || '—')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table></div>
  `;
  wrap.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', () => { location.hash = `#/professores/${tr.dataset.id}`; });
  });
};

Pages.teacherDetail = async function (root, id) {
  const teacher = await api.get(`/api/teachers/${id}`);
  let activeTab = 'dados';

  root.innerHTML = `
    <div class="page-header">
      <div><div class="eyebrow">Professor</div><h1>${escapeHtml(teacher.name)}</h1>
        <p class="subtitle">${teacher.subjects.map(s => escapeHtml(s.name)).join(', ') || 'Nenhuma disciplina cadastrada'}</p></div>
      <div class="flex gap-10">
        <a href="#/professores" class="btn btn-outline">&larr; Voltar</a>
        <button class="btn btn-danger" id="delete-teacher-btn">Remover</button>
      </div>
    </div>
    <div class="tabs">
      <button class="tab-btn active" data-tab="dados">Dados</button>
      <button class="tab-btn" data-tab="calendario">Calendário de aulas</button>
      <button class="tab-btn" data-tab="quinzenas">Horas e quinzenas</button>
    </div>
    <div id="tab-content"></div>
  `;

  document.getElementById('delete-teacher-btn').addEventListener('click', async () => {
    const ok = await confirmModal(`Remover ${teacher.name}? O histórico de aulas e faturas será mantido, mas ele não aparecerá mais nas listas.`, 'Remover professor');
    if (!ok) return;
    await api.delete(`/api/teachers/${id}`);
    showToast('Professor removido.');
    location.hash = '#/professores';
  });

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
    if (activeTab === 'dados') renderDados(el);
    else if (activeTab === 'calendario') renderCalendario(el);
    else if (activeTab === 'quinzenas') renderQuinzenas(el);
  }

  function renderDados(el) {
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h2>Dados cadastrais</h2>
          <button class="btn btn-outline btn-sm" id="edit-teacher-btn">Editar</button></div>
        <div class="field-row">
          <div><div class="text-sm muted">Telefone</div><p>${escapeHtml(teacher.phone || '—')}</p></div>
          <div><div class="text-sm muted">Chave PIX</div><p>${escapeHtml(teacher.pix || '—')}</p></div>
        </div>
        <div><div class="text-sm muted">Endereço</div><p>${escapeHtml(teacher.address || '—')}</p></div>
        <div><div class="text-sm muted">Disciplinas</div><p>${teacher.subjects.map(s => escapeHtml(s.name)).join(', ') || '—'}</p></div>
        <div><div class="text-sm muted">Disponibilidade (informativo)</div><p>${escapeHtml(teacher.availability || '—')}</p></div>
      </div>
    `;
    document.getElementById('edit-teacher-btn').addEventListener('click', () => {
      teacherFormModal(teacher, () => Pages.teacherDetail(root, id));
    });
  }

  function renderCalendario(el) {
    el.innerHTML = `<div class="card"><div id="teacher-cal"></div></div>`;
    Calendar.mount(document.getElementById('teacher-cal'), { view: 'month', refDate: new Date() }, {
      fetchClasses: async (start, end) => api.get(`/api/classes?teacherId=${id}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
      onSelectClass: (cls) => openClassDetailModal(cls, () => renderCalendario(el)),
      onCreateAt: (date) => openClassFormModal({ presetDate: date, presetTeacherId: id }, () => renderCalendario(el)),
    });
  }

  function renderQuinzenas(el) {
    const { first, second } = teacher.currentPeriods;
    el.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">1ª quinzena (dia 1 a 15) — em andamento</div>
          <div class="stat-value accent tabular">${formatCurrency(first.totalValue)}</div>
          <div class="text-sm muted">${first.totalHours}h dadas até agora</div></div>
        <div class="stat-card"><div class="stat-label">2ª quinzena (dia 16 ao fim do mês) — em andamento</div>
          <div class="stat-value accent tabular">${formatCurrency(second.totalValue)}</div>
          <div class="text-sm muted">${second.totalHours}h dadas até agora</div></div>
      </div>
      <div class="card">
        <div class="card-header"><h2>Faturas geradas</h2></div>
        ${teacher.invoices.length === 0 ? `<div class="empty-state">Nenhuma fatura gerada ainda. Faturas são geradas automaticamente assim que uma quinzena se encerra.</div>` : `
        <div class="table-wrap"><table>
          <thead><tr><th>Período</th><th class="num">Horas</th><th class="num">Valor</th><th>Status</th></tr></thead>
          <tbody>
            ${teacher.invoices.map(inv => `
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

  renderTab();
};
