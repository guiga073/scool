// public/js/feedback-panel.js
// Componente compartilhado de "Alunos e feedback". Funciona tanto no painel do
// professor (área dele) quanto no painel do administrador (ficha do professor),
// bastando passar a base de API certa para cada caso.

const FeedbackPanel = {
  // container: elemento DOM. students: [{id, name}], já ordenados.
  // apiBaseFor(studentId): devolve a base da API para aquele aluno, ex.:
  //   professor:   `/api/teacher-portal/students/${studentId}`
  //   secretaria:  `/api/teachers/${teacherId}/students/${studentId}`
  renderStudentList(container, students, apiBaseFor) {
    if (students.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="eyebrow">Nenhum aluno ainda</div>Assim que houver uma aula agendada com um aluno, ele aparece aqui.</div>`;
      return;
    }
    container.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Aluno</th><th></th></tr></thead>
        <tbody>${students.map(s => `<tr class="row-link" data-id="${s.id}"><td><strong>${escapeHtml(s.name)}</strong></td><td class="muted text-sm">Ver feedback &rarr;</td></tr>`).join('')}</tbody>
      </table></div>
    `;
    container.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => {
        const student = students.find(s => String(s.id) === tr.dataset.id);
        FeedbackPanel.renderStudentDetail(container, student, apiBaseFor, () => FeedbackPanel.renderStudentList(container, students, apiBaseFor));
      });
    });
  },

  async renderStudentDetail(container, student, apiBaseFor, onBack) {
    const base = apiBaseFor(student.id);
    container.innerHTML = `<div class="loading-dots">Carregando…</div>`;
    const entries = await api.get(`${base}/feedback`);

    container.innerHTML = `
      <div class="flex-between" style="margin-bottom:14px;">
        <button class="btn btn-outline btn-sm" id="fb-back">&larr; Todos os alunos</button>
        <div class="flex gap-8">
          <button class="btn btn-outline btn-sm" id="fb-view-text">Ver como texto</button>
          <button class="btn btn-accent btn-sm" id="fb-add">+ Adicionar feedback</button>
        </div>
      </div>
      <h3 style="margin-bottom:14px;">${escapeHtml(student.name)}</h3>
      <div id="fb-list"></div>
    `;
    container.querySelector('#fb-back').addEventListener('click', onBack);
    container.querySelector('#fb-add').addEventListener('click', () => FeedbackPanel._openAddModal(base, () => FeedbackPanel.renderStudentDetail(container, student, apiBaseFor, onBack)));
    container.querySelector('#fb-view-text').addEventListener('click', async () => {
      const fresh = await api.get(`${base}/feedback`);
      FeedbackPanel._openTextModal(student.name, fresh);
    });

    const listEl = container.querySelector('#fb-list');
    if (entries.length === 0) {
      listEl.innerHTML = `<div class="empty-state">Nenhum feedback registrado ainda para ${escapeHtml(student.name)}.</div>`;
      return;
    }
    listEl.innerHTML = entries.map(f => `
      <div class="card" style="margin-bottom:10px; padding:14px 16px;">
        <div class="flex-between">
          <span class="text-sm" style="font-weight:700; color:var(--ink-soft);">${FeedbackPanel._fmtDate(f.date)}</span>
          <button class="btn-text text-sm" data-del="${f.id}">Excluir</button>
        </div>
        <p style="margin:6px 0 0 0; white-space:pre-wrap;">${escapeHtml(f.feedback)}</p>
      </div>
    `).join('');
    listEl.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ok = await confirmModal('Excluir este feedback? Essa ação não pode ser desfeita.', 'Excluir');
        if (!ok) return;
        await api.delete(`${base}/feedback/${btn.dataset.del}`);
        FeedbackPanel.renderStudentDetail(container, student, apiBaseFor, onBack);
      });
    });
  },

  _fmtDate(isoDate) {
    const [y, m, d] = String(isoDate).split('-');
    return `${d}/${m}/${y}`;
  },

  _openAddModal(base, onSaved) {
    const backdrop = openModal(`
      <div class="modal-header"><h3>Adicionar feedback</h3><button class="modal-close" id="af-close">&times;</button></div>
      <form id="add-feedback-form">
        <div class="field"><label for="af-date">Data</label>
          <input type="date" id="af-date" value="${new Date().toISOString().slice(0, 10)}" required></div>
        <div class="field"><label for="af-text">Feedback</label>
          <textarea id="af-text" rows="5" required placeholder="Como foi a aula, o que o aluno precisa praticar, etc."></textarea></div>
        <div id="af-error" class="alert alert-danger hidden"></div>
        <div class="form-actions"><button type="button" class="btn btn-outline" id="af-cancel">Cancelar</button><button type="submit" class="btn btn-primary">Salvar</button></div>
      </form>
    `);
    backdrop.querySelector('#af-close').onclick = closeModal;
    backdrop.querySelector('#af-cancel').onclick = closeModal;
    backdrop.querySelector('#add-feedback-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = backdrop.querySelector('#af-error');
      errEl.classList.add('hidden');
      try {
        await api.post(`${base}/feedback`, {
          date: backdrop.querySelector('#af-date').value,
          feedback: backdrop.querySelector('#af-text').value.trim(),
        });
        closeModal();
        showToast('Feedback adicionado.');
        onSaved();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    });
  },

  _openTextModal(studentName, entries) {
    const text = entries.length === 0
      ? 'Nenhum feedback registrado ainda.'
      : entries.slice().reverse().map(f => `Data: ${FeedbackPanel._fmtDate(f.date)}\nFeedback: ${f.feedback}`).join('\n\n');
    const backdrop = openModal(`
      <div class="modal-header"><h3>Feedback de ${escapeHtml(studentName)} — em texto</h3><button class="modal-close" id="tx-close">&times;</button></div>
      <textarea id="tx-area" readonly rows="14" style="font-family:inherit; white-space:pre-wrap;">${escapeHtml(text)}</textarea>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" id="tx-close2">Fechar</button>
        <button type="button" class="btn btn-primary" id="tx-copy">Copiar texto</button>
      </div>
    `, { wide: true });
    backdrop.querySelector('#tx-close').onclick = closeModal;
    backdrop.querySelector('#tx-close2').onclick = closeModal;
    backdrop.querySelector('#tx-copy').addEventListener('click', async () => {
      const area = backdrop.querySelector('#tx-area');
      try {
        await navigator.clipboard.writeText(text);
        showToast('Texto copiado.');
      } catch (e) {
        area.removeAttribute('readonly');
        area.focus();
        area.select();
        showToast('Selecionado — use Ctrl/Cmd+C para copiar.');
      }
    });
  },
};
