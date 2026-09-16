// public/js/pages/students.js

window.Pages = window.Pages || {};

function studentFormModal(existing, onSaved) {
  const s = existing || {};
  const html = `
    <div class="modal-header"><h3>${existing ? 'Editar aluno' : 'Novo aluno'}</h3>
      <button class="modal-close" id="sf-close">&times;</button></div>
    <form id="student-form">
      <div class="field"><label for="sf-name">Nome do aluno</label>
        <input type="text" id="sf-name" value="${escapeHtml(s.name || '')}" required></div>
      <div class="field-row">
        <div class="field"><label for="sf-phone">Telefone do aluno</label>
          <input type="tel" id="sf-phone" value="${escapeHtml(s.phone || '')}"></div>
        <div class="field"><label for="sf-email">E-mail</label>
          <input type="email" id="sf-email" value="${escapeHtml(s.email || '')}"></div>
      </div>
      <div class="field"><label for="sf-address">Endereço</label>
        <input type="text" id="sf-address" value="${escapeHtml(s.address || '')}"></div>
      <div class="field-row">
        <div class="field"><label for="sf-guardian">Nome do responsável</label>
          <input type="text" id="sf-guardian" value="${escapeHtml(s.guardian_name || '')}"></div>
        <div class="field"><label for="sf-guardian-phone">Telefone do responsável</label>
          <input type="tel" id="sf-guardian-phone" value="${escapeHtml(s.guardian_phone || '')}"></div>
      </div>
      <div class="field">
        <div class="checkbox-row">
          <input type="checkbox" id="sf-monthly" ${s.monthly_payment ? 'checked' : ''}>
          <label for="sf-monthly">Pagamento mensal (em vez de pagar por aula)</label>
        </div>
        <div class="hint">As aulas continuam sendo registradas e aparecendo no calendário normalmente. Elas só não entram na lista de "a receber por aula" — em vez disso, este aluno aparece em "Pagamentos especiais" com o valor mensal abaixo.</div>
      </div>
      <div class="field ${s.monthly_payment ? '' : 'hidden'}" id="sf-monthly-value-wrap">
        <label for="sf-monthly-value">Valor mensal (R$)</label>
        <input type="number" step="0.01" min="0" id="sf-monthly-value" value="${s.monthly_value != null ? s.monthly_value : ''}">
      </div>
      <div id="sf-error" class="alert alert-danger hidden"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" id="sf-cancel">Cancelar</button>
        <button type="submit" class="btn btn-primary">${existing ? 'Salvar alterações' : 'Cadastrar aluno'}</button>
      </div>
    </form>
  `;
  const backdrop = openModal(html);
  backdrop.querySelector('#sf-close').onclick = closeModal;
  backdrop.querySelector('#sf-cancel').onclick = closeModal;
  const monthlyCheckbox = backdrop.querySelector('#sf-monthly');
  monthlyCheckbox.addEventListener('change', () => {
    backdrop.querySelector('#sf-monthly-value-wrap').classList.toggle('hidden', !monthlyCheckbox.checked);
  });

  backdrop.querySelector('#student-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = backdrop.querySelector('#sf-error');
    errEl.classList.add('hidden');
    const payload = {
      name: backdrop.querySelector('#sf-name').value.trim(),
      phone: backdrop.querySelector('#sf-phone').value.trim(),
      email: backdrop.querySelector('#sf-email').value.trim(),
      address: backdrop.querySelector('#sf-address').value.trim(),
      guardian_name: backdrop.querySelector('#sf-guardian').value.trim(),
      guardian_phone: backdrop.querySelector('#sf-guardian-phone').value.trim(),
      monthly_payment: monthlyCheckbox.checked,
      monthly_value: monthlyCheckbox.checked ? Number(backdrop.querySelector('#sf-monthly-value').value || 0) : null,
    };
    try {
      const saved = existing ? await api.put(`/api/students/${existing.id}`, payload) : await api.post('/api/students', payload);
      closeModal();
      showToast(existing ? 'Aluno atualizado.' : 'Aluno cadastrado.');
      onSaved(saved);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });
}

Pages.studentsList = async function (root, opts) {
  const search = (opts && opts.search) || '';
  root.innerHTML = `
    <div class="page-header">
      <div><div class="eyebrow">Cadastro</div><h1>Alunos</h1>
        <p class="subtitle">Cadastre alunos e acompanhe dados, aulas e notas de cada um.</p></div>
      <button class="btn btn-accent" id="add-student-btn">+ Cadastrar aluno</button>
    </div>
    <div class="card">
      <input type="text" class="search-input" id="student-search" placeholder="Buscar aluno por nome…" value="${escapeHtml(search)}">
      <div id="student-list-wrap" style="margin-top:16px;"><div class="loading-dots">Carregando…</div></div>
    </div>
  `;

  document.getElementById('add-student-btn').addEventListener('click', () => {
    studentFormModal(null, (created) => { location.hash = `#/alunos/${created.id}`; });
  });

  const searchInput = document.getElementById('student-search');
  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => loadList(searchInput.value), 250);
  });

  async function loadList(q) {
    const wrap = document.getElementById('student-list-wrap');
    const students = await api.get(`/api/students${q ? '?search=' + encodeURIComponent(q) : ''}`);
    if (students.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><div class="eyebrow">Nenhum aluno</div>${q ? 'Nenhum aluno encontrado para essa busca.' : 'Cadastre o primeiro aluno para começar.'}</div>`;
      return;
    }
    wrap.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Nome</th><th>Responsável</th><th>Telefone</th><th>Pagamento</th></tr></thead>
        <tbody>
          ${students.map(s => `
            <tr class="row-link" data-id="${s.id}">
              <td><strong>${escapeHtml(s.name)}</strong></td>
              <td>${escapeHtml(s.guardian_name || '—')}</td>
              <td>${escapeHtml(s.phone || s.guardian_phone || '—')}</td>
              <td>${s.monthly_payment ? `<span class="badge badge-pending">Mensal · ${formatCurrency(s.monthly_value)}</span>` : `<span class="badge badge-neutral">Por aula</span>`}</td>
            </tr>
          `).join('')}
        </tbody>
      </table></div>
    `;
    wrap.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => { location.hash = `#/alunos/${tr.dataset.id}`; });
    });
  }
  loadList(search);
};

Pages.studentDetail = async function (root, id) {
  const student = await api.get(`/api/students/${id}`);
  let activeTab = 'dados';

  root.innerHTML = `
    <div class="page-header">
      <div><div class="eyebrow">Aluno</div><h1>${escapeHtml(student.name)}</h1>
        <p class="subtitle">${student.monthly_payment ? `Pagamento mensal · ${formatCurrency(student.monthly_value)}` : 'Pagamento por aula'}</p></div>
      <div class="flex gap-10">
        <a href="#/alunos" class="btn btn-outline">&larr; Voltar</a>
        <button class="btn btn-danger" id="delete-student-btn">Remover</button>
      </div>
    </div>
    <div class="tabs">
      <button class="tab-btn active" data-tab="dados">Dados</button>
      <button class="tab-btn" data-tab="calendario">Calendário de aulas</button>
      <button class="tab-btn" data-tab="notas">Notas</button>
      <button class="tab-btn" data-tab="observacoes">Observações</button>
    </div>
    <div id="tab-content"></div>
  `;

  document.getElementById('delete-student-btn').addEventListener('click', async () => {
    const ok = await confirmModal(`Remover ${student.name}? O histórico de aulas e pagamentos será mantido, mas o aluno não aparecerá mais nas listas.`, 'Remover aluno');
    if (!ok) return;
    await api.delete(`/api/students/${id}`);
    showToast('Aluno removido.');
    location.hash = '#/alunos';
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
    else if (activeTab === 'notas') renderNotas(el);
    else if (activeTab === 'observacoes') renderObservacoes(el);
  }

  function renderDados(el) {
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h2>Dados cadastrais</h2>
          <button class="btn btn-outline btn-sm" id="edit-student-btn">Editar</button></div>
        <div class="field-row">
          <div><div class="text-sm muted">Telefone</div><p>${escapeHtml(student.phone || '—')}</p></div>
          <div><div class="text-sm muted">E-mail</div><p>${escapeHtml(student.email || '—')}</p></div>
        </div>
        <div><div class="text-sm muted">Endereço</div><p>${escapeHtml(student.address || '—')}</p></div>
        <div class="field-row">
          <div><div class="text-sm muted">Responsável</div><p>${escapeHtml(student.guardian_name || '—')}</p></div>
          <div><div class="text-sm muted">Telefone do responsável</div><p>${escapeHtml(student.guardian_phone || '—')}</p></div>
        </div>
      </div>
    `;
    document.getElementById('edit-student-btn').addEventListener('click', () => {
      studentFormModal(student, () => Pages.studentDetail(root, id));
    });
  }

  function renderCalendario(el) {
    el.innerHTML = `<div class="card"><div id="student-cal"></div></div>`;
    Calendar.mount(document.getElementById('student-cal'), { view: 'month', refDate: new Date() }, {
      fetchClasses: async (start, end) => api.get(`/api/classes?studentId=${id}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
      onSelectClass: (cls) => openClassDetailModal(cls, () => renderCalendario(el)),
      onCreateAt: (date) => openClassFormModal({ presetDate: date, presetStudentId: id }, () => renderCalendario(el)),
    });
  }

  function renderNotas(el) {
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h2>Histórico de notas</h2>
          <button class="btn btn-accent btn-sm" id="add-grade-btn">+ Lançar nota</button></div>
        <div id="grades-list"></div>
      </div>
    `;
    const listEl = document.getElementById('grades-list');
    if (student.grades.length === 0) {
      listEl.innerHTML = `<div class="empty-state">Nenhuma nota lançada ainda.</div>`;
    } else {
      listEl.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Disciplina</th><th>Nota</th><th></th></tr></thead><tbody>
        ${student.grades.map(g => `<tr><td>${formatDate(g.date + ' 00:00:00')}</td><td>${escapeHtml(g.subject)}</td><td><strong>${escapeHtml(g.value)}</strong></td>
          <td><button class="btn-text text-sm" data-del-grade="${g.id}">Excluir</button></td></tr>`).join('')}
      </tbody></table></div>`;
      listEl.querySelectorAll('[data-del-grade]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await api.delete(`/api/students/${id}/grades/${btn.dataset.delGrade}`);
          const fresh = await api.get(`/api/students/${id}`);
          student.grades = fresh.grades;
          renderNotas(el);
        });
      });
    }
    document.getElementById('add-grade-btn').addEventListener('click', () => {
      const backdrop = openModal(`
        <div class="modal-header"><h3>Lançar nota</h3><button class="modal-close" id="gf-close">&times;</button></div>
        <form id="grade-form">
          <div class="field"><label for="gf-subject">Disciplina</label><input type="text" id="gf-subject" required placeholder="Ex.: Matemática"></div>
          <div class="field-row">
            <div class="field"><label for="gf-value">Nota</label><input type="text" id="gf-value" required placeholder="Ex.: 8.5"></div>
            <div class="field"><label for="gf-date">Data</label><input type="date" id="gf-date" value="${new Date().toISOString().slice(0, 10)}"></div>
          </div>
          <div class="form-actions"><button type="button" class="btn btn-outline" id="gf-cancel">Cancelar</button><button type="submit" class="btn btn-primary">Salvar</button></div>
        </form>
      `);
      backdrop.querySelector('#gf-close').onclick = closeModal;
      backdrop.querySelector('#gf-cancel').onclick = closeModal;
      backdrop.querySelector('#grade-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await api.post(`/api/students/${id}/grades`, {
          subject: backdrop.querySelector('#gf-subject').value.trim(),
          value: backdrop.querySelector('#gf-value').value.trim(),
          date: backdrop.querySelector('#gf-date').value,
        });
        closeModal();
        const fresh = await api.get(`/api/students/${id}`);
        student.grades = fresh.grades;
        renderNotas(el);
      });
    });
  }

  function renderObservacoes(el) {
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h2>Observações</h2>
          <button class="btn btn-accent btn-sm" id="add-obs-btn">+ Nova observação</button></div>
        <div id="obs-list"></div>
      </div>
    `;
    const listEl = document.getElementById('obs-list');
    if (student.observations.length === 0) {
      listEl.innerHTML = `<div class="empty-state">Nenhuma observação registrada ainda.</div>`;
    } else {
      listEl.innerHTML = student.observations.map(o => `
        <div style="padding:12px 0; border-bottom:1px solid var(--border);">
          <div class="flex-between"><span class="text-sm muted">${formatDate(o.date + ' 00:00:00')}</span>
            <button class="btn-text text-sm" data-del-obs="${o.id}">Excluir</button></div>
          <p style="margin-top:4px;">${escapeHtml(o.text)}</p>
        </div>
      `).join('');
      listEl.querySelectorAll('[data-del-obs]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await api.delete(`/api/students/${id}/observations/${btn.dataset.delObs}`);
          const fresh = await api.get(`/api/students/${id}`);
          student.observations = fresh.observations;
          renderObservacoes(el);
        });
      });
    }
    document.getElementById('add-obs-btn').addEventListener('click', () => {
      const backdrop = openModal(`
        <div class="modal-header"><h3>Nova observação</h3><button class="modal-close" id="of-close">&times;</button></div>
        <form id="obs-form">
          <div class="field"><label for="of-text">Observação</label><textarea id="of-text" required></textarea></div>
          <div class="form-actions"><button type="button" class="btn btn-outline" id="of-cancel">Cancelar</button><button type="submit" class="btn btn-primary">Salvar</button></div>
        </form>
      `);
      backdrop.querySelector('#of-close').onclick = closeModal;
      backdrop.querySelector('#of-cancel').onclick = closeModal;
      backdrop.querySelector('#obs-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await api.post(`/api/students/${id}/observations`, { text: backdrop.querySelector('#of-text').value.trim() });
        closeModal();
        const fresh = await api.get(`/api/students/${id}`);
        student.observations = fresh.observations;
        renderObservacoes(el);
      });
    });
  }

  renderTab();
};
