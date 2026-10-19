// public/js/pages/leads.js
// Controle de interessados (só a administração vê): pais e responsáveis que pediram informações e ainda
// não agendaram aula. A lista, a ficha de cada interessado e o formulário de cadastro/edição ficam aqui.
// Os dados ficam no servidor (server/leads.js), que confere o login de administrador a cada pedido e
// também é quem diz quais são as situações, modalidades e origens possíveis (GET /api/leads/config).

window.Pages = window.Pages || {};

(function () {
  const NOTES_MAX = 5000;

  // Cor de cada situação (só as cores que o sistema já tem; "Virou aluno" ganha o azul cheio).
  const STATUS_BADGE = {
    novo: 'badge-pending',
    em_conversa: 'badge-confirmed',
    retornar: 'badge-neutral',
    virou_aluno: 'badge-won',
    sem_interesse: 'badge-danger',
  };

  function labelOf(options, key) {
    const found = options.find((o) => o.key === key);
    return found ? found.label : '';
  }

  // O servidor guarda as datas daqui só como dia ("2026-10-20"). Elas NÃO passam por "new Date": o
  // navegador leria como meia-noite em Londres e mostraria o dia anterior.
  function dayText(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
  }

  // Hoje, no relógio do computador da pessoa, no formato do campo de data.
  function todayInput() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function statusBadge(config, key) {
    return `<span class="badge ${STATUS_BADGE[key] || 'badge-neutral'}">${escapeHtml(labelOf(config.statuses, key) || key)}</span>`;
  }

  // Aviso ao lado da data de retorno (o servidor diz como o retorno está; veja followUpState em server/leads.js).
  function followUpFlag(state) {
    if (state === 'overdue') return ' <span class="badge badge-danger">Atrasado</span>';
    if (state === 'today') return ' <span class="badge badge-pending">Hoje</span>';
    return '';
  }

  // Telefone e e-mail viram links (ligar / escrever) na ficha. O telefone só vira link quando parece um
  // número só; textos como "21 99999-1234 / 3333-4444" ficam como texto.
  function phoneHtml(phone) {
    if (!phone) return '—';
    const digits = phone.replace(/\D/g, '');
    if (/^[+()\d\s.-]+$/.test(phone) && digits.length >= 8 && digits.length <= 15) {
      return `<a href="tel:${phone.trim().startsWith('+') ? '+' : ''}${digits}">${escapeHtml(phone)}</a>`;
    }
    return escapeHtml(phone);
  }
  function emailHtml(email) {
    if (!email) return '—';
    return `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`;
  }

  function subjectBadges(subjects) {
    return subjects.map((s) => `<span class="badge badge-neutral" style="margin-right:3px;">${escapeHtml(s.name)}</span>`).join('');
  }

  function studentLine(lead) {
    return [lead.student_name ? `Aluno: ${lead.student_name}` : '', lead.grade_level || ''].filter(Boolean).join(' · ');
  }

  // ---------------------------------------------------------------------------------------------
  // Formulário (cadastrar / editar)
  // ---------------------------------------------------------------------------------------------

  async function leadFormModal(existing, onSaved) {
    const l = existing || {};
    let allSubjects;
    let config;
    try {
      [allSubjects, config] = await Promise.all([api.get('/api/subjects'), api.get('/api/leads/config')]);
    } catch (err) {
      showToast(err.message, 'error');
      return;
    }
    const selectedIds = new Set((l.subjects || []).map((s) => s.id));
    // A mesma lista de séries do cadastro de alunos (definida em students.js), quando disponível.
    const grades = typeof GRADE_LEVEL_SUGGESTIONS !== 'undefined' ? GRADE_LEVEL_SUGGESTIONS : [];
    const options = (list, current, emptyLabel) =>
      (emptyLabel ? `<option value="">${escapeHtml(emptyLabel)}</option>` : '') +
      list.map((o) => `<option value="${escapeHtml(o.key)}"${o.key === current ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
    const saveLabel = existing ? 'Salvar alterações' : 'Cadastrar interessado';

    const html = `
      <div class="modal-header"><h3>${existing ? 'Editar interessado' : 'Novo interessado'}</h3>
        <button type="button" class="modal-close" id="ld-close" aria-label="Fechar">&times;</button></div>
      <form id="lead-form">
        <div class="field"><label for="ld-name">Nome do responsável</label>
          <input type="text" id="ld-name" value="${escapeHtml(l.name || '')}" maxlength="120" required autocomplete="off" placeholder="Ex.: Maria Silva (mãe do Pedro)">
          <div class="hint">Só o nome é obrigatório. Preencha o resto com o que você souber.</div></div>
        <div class="field-row">
          <div class="field"><label for="ld-phone">Telefone / WhatsApp</label>
            <input type="tel" id="ld-phone" value="${escapeHtml(l.phone || '')}" maxlength="40" autocomplete="off"></div>
          <div class="field"><label for="ld-email">E-mail</label>
            <input type="email" id="ld-email" value="${escapeHtml(l.email || '')}" maxlength="120" autocomplete="off"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="ld-student">Nome do aluno</label>
            <input type="text" id="ld-student" value="${escapeHtml(l.student_name || '')}" maxlength="120" autocomplete="off" placeholder="Filho(a) ou quem vai ter aula"></div>
          <div class="field"><label for="ld-grade">Série do aluno</label>
            <input type="text" id="ld-grade" value="${escapeHtml(l.grade_level || '')}" list="ld-grade-options" maxlength="40" autocomplete="off" placeholder="Ex.: 6º ano, 2ª série EM">
            <datalist id="ld-grade-options">${grades.map((g) => `<option value="${escapeHtml(g)}"></option>`).join('')}</datalist></div>
        </div>
        <div class="field"><label>Disciplinas de interesse</label>
          <div class="pill-toggle" id="ld-subjects">
            ${allSubjects.map((s) => `<button type="button" data-id="${s.id}" class="${selectedIds.has(s.id) ? 'active' : ''}">${escapeHtml(s.name)}</button>`).join('')}
          </div>
          <div class="flex gap-8" style="margin-top:8px;">
            <input type="text" id="ld-new-subject" placeholder="Nome de uma nova disciplina…" style="max-width:220px;" autocomplete="off">
            <button type="button" class="btn btn-outline btn-sm" id="ld-add-subject">+ Adicionar disciplina</button>
          </div>
        </div>
        <div class="field-row">
          <div class="field"><label for="ld-modality">Modalidade de interesse</label>
            <select id="ld-modality">${options(config.modalities, l.modality, 'Não informado')}</select></div>
          <div class="field"><label for="ld-source">Como conheceu a Olimais</label>
            <select id="ld-source">${options(config.sources, l.source, 'Não informado')}</select></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="ld-status">Situação</label>
            <select id="ld-status">${options(config.statuses, l.status || 'novo')}</select></div>
          <div class="field"><label for="ld-contact-date">Data do primeiro contato</label>
            <input type="date" id="ld-contact-date" value="${escapeHtml(existing ? (l.contact_date || '') : todayInput())}"></div>
        </div>
        <div class="field"><label for="ld-follow-up">Retornar em</label>
          <input type="date" id="ld-follow-up" value="${escapeHtml(l.follow_up_date || '')}" style="max-width:220px;">
          <div class="hint">Opcional. O dia em que você quer voltar a falar com essa pessoa; se passar sem você mudar a situação, a lista avisa "Atrasado".</div></div>
        <div class="field"><label for="ld-notes">Observações</label>
          <textarea id="ld-notes" rows="5" maxlength="${NOTES_MAX}" placeholder="Ex.: perguntou o valor do pacote de 8 aulas, achou caro por enquanto; pediu para falar de novo em fevereiro…"></textarea>
        </div>

        <div id="ld-error" class="alert alert-danger hidden"></div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" id="ld-cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="ld-save">${saveLabel}</button>
        </div>
      </form>
    `;
    const backdrop = openModal(html, { wide: true });
    const $ = (sel) => backdrop.querySelector(sel);
    $('#ld-notes').value = l.notes || '';
    $('#ld-close').onclick = closeModal;
    $('#ld-cancel').onclick = closeModal;

    function wirePill(btn, id) {
      btn.addEventListener('click', () => {
        if (selectedIds.has(id)) { selectedIds.delete(id); btn.classList.remove('active'); }
        else { selectedIds.add(id); btn.classList.add('active'); }
      });
    }
    backdrop.querySelectorAll('#ld-subjects button').forEach((btn) => wirePill(btn, Number(btn.dataset.id)));

    $('#ld-add-subject').addEventListener('click', async () => {
      const input = $('#ld-new-subject');
      const name = input.value.trim();
      if (!name) return;
      try {
        const created = await api.post('/api/subjects', { name });
        // Se a disciplina já existia (mesmo nome), só marca a que já está na lista.
        const already = Array.from(backdrop.querySelectorAll('#ld-subjects button')).find((b) => Number(b.dataset.id) === created.id);
        if (already) {
          selectedIds.add(created.id);
          already.classList.add('active');
        } else {
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.dataset.id = created.id;
          pill.className = 'active';
          pill.textContent = created.name;
          wirePill(pill, created.id);
          selectedIds.add(created.id);
          $('#ld-subjects').appendChild(pill);
        }
        input.value = '';
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
    // Enter no campo da nova disciplina adiciona a disciplina (e não envia o formulário inteiro).
    $('#ld-new-subject').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('#ld-add-subject').click(); }
    });

    const saveBtn = $('#ld-save');
    const cancelBtn = $('#ld-cancel');
    const errEl = $('#ld-error');

    $('#lead-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (saveBtn.disabled) return;
      errEl.classList.add('hidden');

      const payload = {
        name: $('#ld-name').value.trim(),
        phone: $('#ld-phone').value.trim(),
        email: $('#ld-email').value.trim(),
        student_name: $('#ld-student').value.trim(),
        grade_level: $('#ld-grade').value.trim(),
        subject_ids: Array.from(selectedIds),
        modality: $('#ld-modality').value,
        source: $('#ld-source').value,
        status: $('#ld-status').value,
        contact_date: $('#ld-contact-date').value,
        follow_up_date: $('#ld-follow-up').value,
        notes: $('#ld-notes').value,
      };

      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      saveBtn.textContent = 'Salvando…';
      try {
        const saved = existing ? await api.put(`/api/leads/${existing.id}`, payload) : await api.post('/api/leads', payload);
        if (backdrop.isConnected) closeModal();
        showToast(existing ? 'Alterações salvas.' : 'Interessado cadastrado.');
        onSaved(saved);
      } catch (err) {
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
        saveBtn.textContent = saveLabel;
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Lista
  // ---------------------------------------------------------------------------------------------

  Pages.leadsList = async function (root) {
    const [subjects, config] = await Promise.all([api.get('/api/subjects'), api.get('/api/leads/config')]);
    root.innerHTML = `
      <div class="page-header">
        <div><div class="eyebrow">Cadastro</div><h1>Controle de interessados</h1>
          <p class="subtitle">Guarde aqui os pais e responsáveis que pediram informações mas ainda não agendaram aula, para retomar o contato quando fizer sentido. Só a administração vê esta área.</p></div>
        <div class="flex gap-10 wrap">
          <button class="btn btn-accent" id="add-lead-btn">+ Cadastrar interessado</button>
        </div>
      </div>
      <div class="card">
        <div class="flex gap-10 wrap lead-filters">
          <input type="text" class="search-input" id="lead-search" placeholder="Buscar nome, telefone, aluno…" autocomplete="off" aria-label="Buscar interessado">
          <select id="lead-status" aria-label="Filtrar por situação">
            <option value="">Todas as situações</option>
            ${config.statuses.map((s) => `<option value="${escapeHtml(s.key)}">${escapeHtml(s.label)}</option>`).join('')}
          </select>
          <select id="lead-subject" aria-label="Filtrar por disciplina">
            <option value="">Todas as disciplinas</option>
            ${subjects.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>
        <div id="lead-list-wrap" style="margin-top:16px;"><div class="loading-dots">Carregando…</div></div>
      </div>
    `;
    const wrap = root.querySelector('#lead-list-wrap');
    const searchInput = root.querySelector('#lead-search');
    const statusSelect = root.querySelector('#lead-status');
    const subjectSelect = root.querySelector('#lead-subject');

    root.querySelector('#add-lead-btn').addEventListener('click', () => {
      leadFormModal(null, (created) => { location.hash = `#/interessados/${created.id}`; });
    });

    let seq = 0; // só a resposta do pedido mais recente aparece (digitar rápido não mistura resultados)
    async function loadList() {
      const mine = ++seq;
      const q = searchInput.value.trim();
      const status = statusSelect.value;
      const subjectId = subjectSelect.value;
      const params = [];
      if (q) params.push(`search=${encodeURIComponent(q)}`);
      if (status) params.push(`status=${encodeURIComponent(status)}`);
      if (subjectId) params.push(`subjectId=${encodeURIComponent(subjectId)}`);
      let leads;
      try {
        leads = await api.get(`/api/leads${params.length ? `?${params.join('&')}` : ''}`);
      } catch (err) {
        if (err.status === 401) { window.location.href = '/login.html'; return; }
        if (mine === seq) wrap.innerHTML = `<div class="alert alert-danger">Não foi possível carregar a lista: ${escapeHtml(err.message)}</div>`;
        return;
      }
      if (mine !== seq) return;
      if (leads.length === 0) {
        wrap.innerHTML = (q || status || subjectId)
          ? '<div class="empty-state"><div class="eyebrow">Nenhum interessado</div>Nenhum interessado encontrado para essa busca.</div>'
          : '<div class="empty-state"><div class="eyebrow">Nenhum interessado</div>Cadastre aqui quem entrar em contato mas ainda não agendar aula, e retome a conversa quando quiser.</div>';
        return;
      }
      const dash = '<span class="muted text-sm">—</span>';
      wrap.innerHTML = `
        <p class="text-sm muted" style="margin:0 0 8px 0;">${leads.length === 1 ? '1 interessado' : `${leads.length} interessados`}</p>
        <div class="table-wrap"><table class="lead-table">
          <thead><tr><th>Responsável</th><th>Contato</th><th>Disciplinas</th><th>Situação</th><th>1º contato</th><th>Retorno</th></tr></thead>
          <tbody>
            ${leads.map((l) => `
              <tr class="row-link" data-id="${l.id}">
                <td><strong>${escapeHtml(l.name)}</strong>${studentLine(l) ? `<div class="lead-cell-sub">${escapeHtml(studentLine(l))}</div>` : ''}</td>
                <td>${l.phone ? `<div>${escapeHtml(l.phone)}</div>` : ''}${l.email ? `<div class="lead-cell-sub">${escapeHtml(l.email)}</div>` : ''}${!l.phone && !l.email ? dash : ''}</td>
                <td>${subjectBadges(l.subjects) || dash}</td>
                <td>${statusBadge(config, l.status)}</td>
                <td>${l.contact_date ? escapeHtml(dayText(l.contact_date)) : dash}</td>
                <td>${l.follow_up_date ? `${escapeHtml(dayText(l.follow_up_date))}${followUpFlag(l.follow_up_state)}` : dash}</td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>
      `;
      wrap.querySelectorAll('tr[data-id]').forEach((tr) => {
        tr.addEventListener('click', () => { location.hash = `#/interessados/${tr.dataset.id}`; });
      });
    }

    let debounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(loadList, 250);
    });
    statusSelect.addEventListener('change', loadList);
    subjectSelect.addEventListener('change', loadList);
    loadList();
  };

  // ---------------------------------------------------------------------------------------------
  // Ficha
  // ---------------------------------------------------------------------------------------------

  Pages.leadDetail = async function (root, id) {
    let lead;
    try {
      lead = await api.get(`/api/leads/${encodeURIComponent(id)}`);
    } catch (err) {
      if (err.status !== 404) throw err;
      root.innerHTML = `
        <div class="page-header">
          <div><div class="eyebrow">Interessado</div><h1>Interessado não encontrado</h1></div>
          <div class="flex gap-10"><a href="#/interessados" class="btn btn-outline">&larr; Voltar</a></div>
        </div>
        <div class="empty-state"><div class="eyebrow">Não encontrado</div>Este interessado não existe mais (talvez tenha sido removido).</div>
      `;
      return;
    }
    const config = await api.get('/api/leads/config');

    root.innerHTML = `
      <div class="page-header">
        <div class="lead-wrap"><div class="eyebrow">Interessado</div><h1>${escapeHtml(lead.name)}</h1>
          <p class="subtitle" id="ld-subtitle"></p></div>
        <div class="flex gap-10 wrap">
          <a href="#/interessados" class="btn btn-outline">&larr; Voltar</a>
          <button class="btn btn-danger" id="delete-lead-btn">Remover</button>
        </div>
      </div>
      <div class="card" id="ld-card-dados"></div>
      <div class="card" id="ld-card-follow"></div>
      <div class="card" id="ld-card-notes"></div>
    `;
    const cardDados = root.querySelector('#ld-card-dados');
    const cardFollow = root.querySelector('#ld-card-follow');
    const cardNotes = root.querySelector('#ld-card-notes');
    const subtitle = root.querySelector('#ld-subtitle');

    root.querySelector('#delete-lead-btn').addEventListener('click', async () => {
      const ok = await confirmModal(
        `Remover ${lead.name} do controle de interessados? Os dados e as observações serão apagados, e isso não pode ser desfeito.`,
        'Remover interessado'
      );
      if (!ok) return;
      try {
        await api.delete(`/api/leads/${lead.id}`);
      } catch (err) {
        showToast(err.message, 'error');
        return;
      }
      showToast('Interessado removido.');
      location.hash = '#/interessados';
    });

    // ----- Contato e interesse -----
    function renderDados() {
      subtitle.textContent = studentLine(lead) || 'Sem dados do aluno';
      cardDados.innerHTML = `
        <div class="card-header"><h2>Contato e interesse</h2>
          <button class="btn btn-outline btn-sm" id="edit-lead-btn">Editar</button></div>
        <div class="field-row">
          <div><div class="text-sm muted">Telefone / WhatsApp</div><p class="lead-wrap">${phoneHtml(lead.phone)}</p></div>
          <div><div class="text-sm muted">E-mail</div><p class="lead-wrap">${emailHtml(lead.email)}</p></div>
        </div>
        <div class="field-row">
          <div><div class="text-sm muted">Aluno</div><p class="lead-wrap">${escapeHtml(lead.student_name || '—')}</p></div>
          <div><div class="text-sm muted">Série</div><p class="lead-wrap">${escapeHtml(lead.grade_level || '—')}</p></div>
        </div>
        <div><div class="text-sm muted">Disciplinas de interesse</div><p class="lead-wrap">${subjectBadges(lead.subjects) || '—'}</p></div>
        <div class="field-row">
          <div><div class="text-sm muted">Modalidade de interesse</div><p class="mb-0">${escapeHtml(labelOf(config.modalities, lead.modality) || '—')}</p></div>
          <div><div class="text-sm muted">Como conheceu a Olimais</div><p class="mb-0">${escapeHtml(labelOf(config.sources, lead.source) || '—')}</p></div>
        </div>
      `;
      cardDados.querySelector('#edit-lead-btn').addEventListener('click', () => {
        leadFormModal(lead, () => Pages.leadDetail(root, id));
      });
    }

    // ----- Acompanhamento (a situação muda aqui mesmo, sem abrir o formulário) -----
    function renderFollow() {
      cardFollow.innerHTML = `
        <div class="card-header"><h2>Acompanhamento</h2></div>
        <div class="field-row">
          <div><div class="text-sm muted">Situação</div>
            <p style="margin-bottom:6px;">${statusBadge(config, lead.status)}</p>
            <select id="ld-quick-status" aria-label="Mudar a situação">
              ${config.statuses.map((s) => `<option value="${escapeHtml(s.key)}"${s.key === lead.status ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}
            </select></div>
          <div><div class="text-sm muted">Retornar em</div>
            <p class="mb-0">${lead.follow_up_date ? `${escapeHtml(dayText(lead.follow_up_date))}${followUpFlag(lead.follow_up_state)}` : '—'}</p></div>
        </div>
        <div class="field-row" style="margin-top:14px;">
          <div><div class="text-sm muted">Primeiro contato</div><p class="mb-0">${lead.contact_date ? escapeHtml(dayText(lead.contact_date)) : '—'}</p></div>
          <div><div class="text-sm muted">Cadastrado em</div><p class="mb-0">${escapeHtml(formatDate(lead.created_at))}</p></div>
        </div>
        <p class="text-sm muted" style="margin:14px 0 0 0;">Última alteração em ${escapeHtml(formatDateTime(lead.updated_at))}.</p>
      `;
      const quick = cardFollow.querySelector('#ld-quick-status');
      quick.addEventListener('change', async () => {
        const wanted = quick.value;
        quick.disabled = true;
        try {
          // Só a situação vai no pedido: o resto do cadastro não é tocado.
          const saved = await api.put(`/api/leads/${lead.id}`, { status: wanted });
          lead = Object.assign(lead, saved);
          renderFollow();
          showToast('Situação atualizada.');
        } catch (err) {
          quick.disabled = false;
          quick.value = lead.status;
          showToast(err.message, 'error');
        }
      });
    }

    // ----- Observações (editadas aqui mesmo, sem abrir o formulário) -----
    let notesEditing = false;

    function renderNotes() {
      if (!notesEditing) {
        cardNotes.innerHTML = `
          <div class="card-header"><h2>Observações</h2>
            <button type="button" class="btn btn-outline btn-sm" data-act="edit-notes">Editar</button></div>
          ${lead.notes
            ? `<p class="lead-notes">${escapeHtml(lead.notes)}</p>`
            : '<p class="muted mt-0 mb-0">Nenhuma observação ainda. Use este espaço para anotar o que a pessoa perguntou, o que achou do valor, quando pediu para você voltar a falar…</p>'}
        `;
        cardNotes.querySelector('[data-act="edit-notes"]').addEventListener('click', () => { notesEditing = true; renderNotes(); });
        return;
      }
      cardNotes.innerHTML = `
        <div class="card-header"><h2>Observações</h2></div>
        <textarea id="ld-notes-edit" rows="7" maxlength="${NOTES_MAX}" aria-label="Observações"></textarea>
        <div class="alert alert-danger hidden" id="ld-notes-error" style="margin-top:10px;"></div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" data-act="cancel-notes">Cancelar</button>
          <button type="button" class="btn btn-primary" data-act="save-notes">Salvar observações</button>
        </div>
      `;
      const ta = cardNotes.querySelector('#ld-notes-edit');
      ta.value = lead.notes || '';
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      cardNotes.querySelector('[data-act="cancel-notes"]').addEventListener('click', () => { notesEditing = false; renderNotes(); });
      const saveBtn = cardNotes.querySelector('[data-act="save-notes"]');
      saveBtn.addEventListener('click', async () => {
        const errEl = cardNotes.querySelector('#ld-notes-error');
        errEl.classList.add('hidden');
        saveBtn.disabled = true;
        try {
          // Só as observações vão no pedido: o resto do cadastro não é tocado.
          const saved = await api.put(`/api/leads/${lead.id}`, { notes: ta.value });
          lead = Object.assign(lead, saved);
          notesEditing = false;
          renderNotes();
          renderFollow();
          showToast('Observações salvas.');
        } catch (err) {
          saveBtn.disabled = false;
          errEl.textContent = err.message;
          errEl.classList.remove('hidden');
        }
      });
    }

    renderDados();
    renderFollow();
    renderNotes();
  };
})();
