// public/js/pages/feedbacks.js

window.Pages = window.Pages || {};

Pages.feedbacks = async function (root) {
  let mode = 'aluno'; // 'aluno' | 'professor'
  let selected = null; // { id, name }

  root.innerHTML = `
    <div class="page-header">
      <div><div class="eyebrow">Acompanhamento</div><h1>Feedbacks</h1>
        <p class="subtitle">Veja o feedback de aula registrado pelos professores, buscando por aluno ou por professor.</p></div>
    </div>
    <div class="card">
      <div class="pill-toggle" id="fb-mode-toggle" style="margin-bottom:14px;">
        <button type="button" data-mode="aluno" class="active">Por aluno</button>
        <button type="button" data-mode="professor">Por professor</button>
      </div>
      <input type="text" class="search-input" id="fb-search" placeholder="Buscar aluno por nome…">
      <div id="fb-search-results" style="margin-top:12px;"></div>
    </div>
    <div id="fb-detail"></div>
  `;

  const searchInput = document.getElementById('fb-search');
  const resultsEl = document.getElementById('fb-search-results');
  const detailEl = document.getElementById('fb-detail');

  document.querySelectorAll('#fb-mode-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#fb-mode-toggle button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      mode = btn.dataset.mode;
      selected = null;
      detailEl.innerHTML = '';
      searchInput.value = '';
      searchInput.placeholder = mode === 'aluno' ? 'Buscar aluno por nome…' : 'Buscar professor por nome…';
      resultsEl.innerHTML = '';
      runSearch('');
    });
  });

  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => runSearch(searchInput.value), 250);
  });

  async function runSearch(q) {
    const endpoint = mode === 'aluno' ? '/api/students' : '/api/teachers';
    const people = await api.get(`${endpoint}${q ? '?search=' + encodeURIComponent(q) : ''}`);
    if (people.length === 0) {
      resultsEl.innerHTML = `<div class="empty-state text-sm" style="padding:16px;">Nenhum ${mode === 'aluno' ? 'aluno' : 'professor'} encontrado.</div>`;
      return;
    }
    resultsEl.innerHTML = `<div class="pill-toggle">${people.map(p => `<button type="button" data-id="${p.id}" data-name="${escapeHtml(p.name)}" class="${selected && selected.id === p.id ? 'active' : ''}">${escapeHtml(p.name)}</button>`).join('')}</div>`;
    resultsEl.querySelectorAll('button[data-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        resultsEl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selected = { id: Number(btn.dataset.id), name: btn.dataset.name };
        renderDetail();
      });
    });
  }

  async function renderDetail() {
    detailEl.innerHTML = `<div class="card"><div class="loading-dots">Carregando…</div></div>`;
    const endpoint = mode === 'aluno' ? `/api/students/${selected.id}/feedback` : `/api/teachers/${selected.id}/feedback`;
    const entries = await api.get(endpoint);

    detailEl.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>${mode === 'aluno' ? 'Feedback recebido por' : 'Feedback dado por'} ${escapeHtml(selected.name)}</h2>
          <button class="btn btn-outline btn-sm" id="fb-view-text" ${entries.length === 0 ? 'disabled' : ''}>Ver como texto</button>
        </div>
        <div id="fb-entries"></div>
      </div>
    `;

    const entriesEl = document.getElementById('fb-entries');
    if (entries.length === 0) {
      entriesEl.innerHTML = `<div class="empty-state">Nenhum feedback registrado ainda.</div>`;
    } else {
      entriesEl.innerHTML = entries.map(f => `
        <div class="card" style="margin-bottom:10px; padding:14px 16px;">
          <div class="flex-between">
            <span class="text-sm" style="font-weight:700; color:var(--ink-soft);">
              ${FeedbackPanel._fmtDate(f.date)} · ${mode === 'aluno' ? escapeHtml(f.teacher_name) : escapeHtml(f.student_name)}
            </span>
            <button class="btn-text text-sm" data-del="${f.id}" data-tid="${f.teacher_id}" data-sid="${f.student_id}">Excluir</button>
          </div>
          <p style="margin:6px 0 0 0; white-space:pre-wrap;">${escapeHtml(f.feedback)}</p>
        </div>
      `).join('');
      entriesEl.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const ok = await confirmModal('Excluir este feedback? Essa ação não pode ser desfeita.', 'Excluir');
          if (!ok) return;
          await api.delete(`/api/teachers/${btn.dataset.tid}/students/${btn.dataset.sid}/feedback/${btn.dataset.del}`);
          renderDetail();
        });
      });
    }

    document.getElementById('fb-view-text').addEventListener('click', () => {
      const text = entries.slice().reverse().map(f => {
        const who = mode === 'aluno' ? `Professor: ${f.teacher_name}\n` : `Aluno: ${f.student_name}\n`;
        return `Data: ${FeedbackPanel._fmtDate(f.date)}\n${who}Feedback: ${f.feedback}`;
      }).join('\n\n');
      const backdrop = openModal(`
        <div class="modal-header"><h3>Feedback de ${escapeHtml(selected.name)} — em texto</h3><button class="modal-close" id="fbtx-close">&times;</button></div>
        <textarea id="fbtx-area" readonly rows="14" style="font-family:inherit; white-space:pre-wrap;">${escapeHtml(text)}</textarea>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" id="fbtx-close2">Fechar</button>
          <button type="button" class="btn btn-primary" id="fbtx-copy">Copiar texto</button>
        </div>
      `, { wide: true });
      backdrop.querySelector('#fbtx-close').onclick = closeModal;
      backdrop.querySelector('#fbtx-close2').onclick = closeModal;
      backdrop.querySelector('#fbtx-copy').addEventListener('click', async () => {
        const area = backdrop.querySelector('#fbtx-area');
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
    });
  }

  runSearch('');
};
