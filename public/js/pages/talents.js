// public/js/pages/talents.js
// Banco de talentos (só a administração vê): potenciais professores que podem ser contratados no futuro.
// A lista, a ficha de cada talento e o formulário de cadastro/edição ficam aqui. Os dados e o currículo
// ficam no servidor (server/talents.js), que confere o login de administrador a cada pedido.

window.Pages = window.Pages || {};

(function () {
  const NOTES_MAX = 5000;
  const CV_TYPES_TEXT = 'PDF, Word (.doc ou .docx), .odt, .rtf ou imagem (JPG, PNG, WEBP)';

  function extOf(name) {
    const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  // Tamanho legível sem o ",0" dos números redondos ("5 MB" e não "5,0 MB"), igual às mensagens do servidor.
  function sizeText(bytes) {
    return formatBytes(bytes).replace(',0 ', ' ');
  }

  function cvRulesText(config) {
    return `Aceitamos ${CV_TYPES_TEXT}, de até ${sizeText(config.maxCvBytes)}.`;
  }

  // Motivo pelo qual o arquivo não pode ser o currículo (ou null quando está tudo certo). O servidor
  // confere tudo de novo; aqui é só para avisar logo, sem esperar o envio.
  function cvProblem(file, config) {
    const ext = extOf(file.name);
    if (!ext || !config.allowedExtensions.includes(ext)) {
      if (ext === 'heic' || ext === 'heif') return 'Fotos no formato HEIC não são aceitas. Converta para JPG e envie de novo.';
      if (ext === 'pages') return 'Arquivos do Pages não são aceitos. Exporte como PDF ou Word e envie de novo.';
      return `Tipo de arquivo não aceito${ext ? ` (.${ext})` : ''}. Envie ${CV_TYPES_TEXT}.`;
    }
    if (file.size === 0) return 'O arquivo está vazio.';
    if (file.size > config.maxCvBytes) {
      // Logo acima do limite os dois tamanhos arredondam igual ("5 MB" e "5 MB"); aí mostra os bytes.
      const shown = sizeText(file.size) === sizeText(config.maxCvBytes) ? `${file.size.toLocaleString('pt-BR')} bytes` : sizeText(file.size);
      return `Grande demais (${shown}); o máximo é ${sizeText(config.maxCvBytes)}. Comprima o arquivo ou envie uma versão menor.`;
    }
    return null;
  }

  // O nome do arquivo vai num cabeçalho HTTP, que só aceita texto simples: por isso é codificado.
  function fileNameHeader(file) {
    try { return encodeURIComponent(file.name); } catch (e) { return encodeURIComponent(`curriculo.${extOf(file.name)}`); }
  }

  function sendCv(talentId, file, onProgress) {
    return api.upload(`/api/talents/${talentId}/cv`, file, {
      headers: { 'X-File-Name': fileNameHeader(file) },
      onProgress,
    });
  }

  function cvTileClass(cv) {
    return cv.ext === 'pdf' ? 'mat-ext-pdf' : cv.image ? 'mat-ext-img' : 'mat-ext-doc';
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

  function moneyOrDash(value) {
    return value !== null && value !== undefined ? formatCurrency(value) : '—';
  }

  function subjectBadges(subjects) {
    return subjects.map((s) => `<span class="badge badge-neutral" style="margin-right:3px;">${escapeHtml(s.name)}</span>`).join('');
  }

  // ---------------------------------------------------------------------------------------------
  // Formulário (cadastrar / editar)
  // ---------------------------------------------------------------------------------------------

  async function talentFormModal(existing, onSaved) {
    const t = existing || {};
    let allSubjects;
    let config;
    try {
      [allSubjects, config] = await Promise.all([api.get('/api/subjects'), api.get('/api/talents/config')]);
    } catch (err) {
      showToast(err.message, 'error');
      return;
    }
    const selectedIds = new Set((t.subjects || []).map((s) => s.id));
    const accept = config.allowedExtensions.map((e) => `.${e}`).join(',');
    const rate = (v) => (v !== null && v !== undefined ? v : '');
    const saveLabel = existing ? 'Salvar alterações' : 'Cadastrar talento';

    const html = `
      <div class="modal-header"><h3>${existing ? 'Editar talento' : 'Novo talento'}</h3>
        <button type="button" class="modal-close" id="tl-close" aria-label="Fechar">&times;</button></div>
      <form id="talent-form">
        <div class="field"><label for="tl-name">Nome do talento</label>
          <input type="text" id="tl-name" value="${escapeHtml(t.name || '')}" maxlength="120" required autocomplete="off"></div>
        <div class="field-row">
          <div class="field"><label for="tl-phone">Telefone</label>
            <input type="tel" id="tl-phone" value="${escapeHtml(t.phone || '')}" maxlength="40" autocomplete="off"></div>
          <div class="field"><label for="tl-email">E-mail</label>
            <input type="email" id="tl-email" value="${escapeHtml(t.email || '')}" maxlength="120" autocomplete="off"></div>
        </div>
        <div class="field"><label for="tl-address">Endereço</label>
          <input type="text" id="tl-address" value="${escapeHtml(t.address || '')}" maxlength="200" autocomplete="off"></div>
        <div class="field"><label>Disciplinas que poderia lecionar</label>
          <div class="pill-toggle" id="tl-subjects">
            ${allSubjects.map((s) => `<button type="button" data-id="${s.id}" class="${selectedIds.has(s.id) ? 'active' : ''}">${escapeHtml(s.name)}</button>`).join('')}
          </div>
          <div class="flex gap-8" style="margin-top:8px;">
            <input type="text" id="tl-new-subject" placeholder="Nome de uma nova disciplina…" style="max-width:220px;" autocomplete="off">
            <button type="button" class="btn btn-outline btn-sm" id="tl-add-subject">+ Adicionar disciplina</button>
          </div>
        </div>

        <div class="field">
          <label>Valor por hora que pretende receber</label>
          <div class="hint" style="margin-top:-2px; margin-bottom:8px;">Só aparece para você — serve de referência na hora de contratar.</div>
          <div class="field-row">
            <div class="field mb-0"><label for="tl-rate-presencial">R$/hora — Presencial</label>
              <input type="number" step="0.01" min="0" id="tl-rate-presencial" value="${rate(t.hourly_rate_presencial)}" placeholder="Ex.: 50"></div>
            <div class="field mb-0"><label for="tl-rate-online">R$/hora — Online</label>
              <input type="number" step="0.01" min="0" id="tl-rate-online" value="${rate(t.hourly_rate_online)}" placeholder="Ex.: 40"></div>
          </div>
        </div>

        <div class="field"><label>Disponibilidade</label>
          <div class="hint" style="margin-top:-2px;">É só uma anotação dos horários em que a pessoa disse poder dar aula.</div>
          <div id="tl-availability-grid" style="margin-top:8px;"></div>
        </div>

        <div class="field"><label for="tl-cv">Currículo</label>
          <input type="file" id="tl-cv" class="talent-file" accept="${escapeHtml(accept)}">
          <div class="hint">${t.cv ? `Já existe um currículo (<strong>${escapeHtml(t.cv.file_name)}</strong>). Escolha um arquivo só se quiser substituí-lo. ` : ''}${escapeHtml(cvRulesText(config))}</div>
          <div class="alert alert-danger hidden" id="tl-cv-error" style="margin-top:8px;"></div>
        </div>

        <div class="field"><label for="tl-notes">Observações</label>
          <textarea id="tl-notes" rows="5" maxlength="${NOTES_MAX}" placeholder="Ex.: conheci na feira de estágio; boa didática; só pode à tarde…"></textarea>
        </div>

        <div class="mat-progress hidden" id="tl-progress"><i></i></div>
        <div id="tl-error" class="alert alert-danger hidden"></div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" id="tl-cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="tl-save">${saveLabel}</button>
        </div>
      </form>
    `;
    const backdrop = openModal(html, { wide: true });
    const $ = (sel) => backdrop.querySelector(sel);
    $('#tl-notes').value = t.notes || '';
    $('#tl-close').onclick = closeModal;
    $('#tl-cancel').onclick = closeModal;

    function wirePill(btn, id) {
      btn.addEventListener('click', () => {
        if (selectedIds.has(id)) { selectedIds.delete(id); btn.classList.remove('active'); }
        else { selectedIds.add(id); btn.classList.add('active'); }
      });
    }
    backdrop.querySelectorAll('#tl-subjects button').forEach((btn) => wirePill(btn, Number(btn.dataset.id)));

    $('#tl-add-subject').addEventListener('click', async () => {
      const input = $('#tl-new-subject');
      const name = input.value.trim();
      if (!name) return;
      try {
        const created = await api.post('/api/subjects', { name });
        // Se a disciplina já existia (mesmo nome), só marca a que já está na lista.
        const already = Array.from(backdrop.querySelectorAll('#tl-subjects button')).find((b) => Number(b.dataset.id) === created.id);
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
          $('#tl-subjects').appendChild(pill);
        }
        input.value = '';
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
    // Enter no campo da nova disciplina adiciona a disciplina (e não envia o formulário inteiro).
    $('#tl-new-subject').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('#tl-add-subject').click(); }
    });

    const gridApi = AvailabilityGrid.render($('#tl-availability-grid'), t.availability_grid || {}, { editable: true });

    const saveBtn = $('#tl-save');
    const cancelBtn = $('#tl-cancel');
    const errEl = $('#tl-error');
    const cvErrEl = $('#tl-cv-error');
    const progress = $('#tl-progress');

    function showError(el, message) { el.textContent = message; el.classList.remove('hidden'); }
    function setBusy(on, label) {
      saveBtn.disabled = on;
      cancelBtn.disabled = on;
      saveBtn.textContent = on ? label : saveLabel;
    }

    // Já avisa na hora se o arquivo escolhido não serve.
    $('#tl-cv').addEventListener('change', (e) => {
      cvErrEl.classList.add('hidden');
      const file = e.target.files[0];
      const problem = file ? cvProblem(file, config) : null;
      if (problem) showError(cvErrEl, problem);
    });

    $('#talent-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (saveBtn.disabled) return;
      errEl.classList.add('hidden');
      cvErrEl.classList.add('hidden');

      const file = $('#tl-cv').files[0] || null;
      const problem = file ? cvProblem(file, config) : null;
      if (problem) { showError(cvErrEl, problem); return; }

      const payload = {
        name: $('#tl-name').value.trim(),
        phone: $('#tl-phone').value.trim(),
        email: $('#tl-email').value.trim(),
        address: $('#tl-address').value.trim(),
        subject_ids: Array.from(selectedIds),
        hourly_rate_presencial: $('#tl-rate-presencial').value,
        hourly_rate_online: $('#tl-rate-online').value,
        availability_grid: gridApi.getValue(),
        notes: $('#tl-notes').value,
      };

      setBusy(true, 'Salvando…');
      let saved;
      try {
        saved = existing ? await api.put(`/api/talents/${existing.id}`, payload) : await api.post('/api/talents', payload);
      } catch (err) {
        setBusy(false);
        showError(errEl, err.message);
        return;
      }

      // O talento já está salvo. O currículo vai em seguida (é um envio de arquivo à parte); se ele falhar, os
      // dados não se perdem: a pessoa segue para a ficha e tenta anexar de novo.
      if (file) {
        setBusy(true, 'Enviando currículo…');
        progress.classList.remove('hidden');
        try {
          saved = await sendCv(saved.id, file, (loaded, total) => {
            const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
            progress.firstElementChild.style.width = `${pct}%`;
          });
        } catch (err) {
          if (backdrop.isConnected) closeModal();
          showToast(`${existing ? 'Alterações salvas' : 'Talento cadastrado'}, mas o currículo não foi enviado: ${err.message} Anexe de novo pela ficha do talento.`, 'error', { duration: 9000 });
          onSaved(saved);
          return;
        }
      }
      if (backdrop.isConnected) closeModal();
      showToast(existing ? 'Talento atualizado.' : 'Talento cadastrado.');
      onSaved(saved);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Lista
  // ---------------------------------------------------------------------------------------------

  Pages.talentsList = async function (root) {
    const subjects = await api.get('/api/subjects');
    root.innerHTML = `
      <div class="page-header">
        <div><div class="eyebrow">Cadastro</div><h1>Banco de talentos</h1>
          <p class="subtitle">Guarde aqui os potenciais professores que você pode querer contratar no futuro, com contato, currículo e suas anotações. Só a administração vê esta área.</p></div>
        <div class="flex gap-10 wrap">
          <button class="btn btn-accent" id="add-talent-btn">+ Cadastrar talento</button>
        </div>
      </div>
      <div class="card">
        <div class="flex gap-10 wrap talent-filters">
          <input type="text" class="search-input" id="talent-search" placeholder="Buscar nome, disciplina, contato…" autocomplete="off" aria-label="Buscar talento">
          <select id="talent-subject" aria-label="Filtrar por disciplina">
            <option value="">Todas as disciplinas</option>
            ${subjects.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>
        <div id="talent-list-wrap" style="margin-top:16px;"><div class="loading-dots">Carregando…</div></div>
      </div>
    `;
    const wrap = root.querySelector('#talent-list-wrap');
    const searchInput = root.querySelector('#talent-search');
    const subjectSelect = root.querySelector('#talent-subject');

    root.querySelector('#add-talent-btn').addEventListener('click', () => {
      talentFormModal(null, (created) => { location.hash = `#/talentos/${created.id}`; });
    });

    let seq = 0; // só a resposta do pedido mais recente aparece (digitar rápido não mistura resultados)
    async function loadList() {
      const mine = ++seq;
      const q = searchInput.value.trim();
      const subjectId = subjectSelect.value;
      const params = [];
      if (q) params.push(`search=${encodeURIComponent(q)}`);
      if (subjectId) params.push(`subjectId=${encodeURIComponent(subjectId)}`);
      let talents;
      try {
        talents = await api.get(`/api/talents${params.length ? `?${params.join('&')}` : ''}`);
      } catch (err) {
        if (err.status === 401) { window.location.href = '/login.html'; return; }
        if (mine === seq) wrap.innerHTML = `<div class="alert alert-danger">Não foi possível carregar a lista: ${escapeHtml(err.message)}</div>`;
        return;
      }
      if (mine !== seq) return;
      if (talents.length === 0) {
        wrap.innerHTML = (q || subjectId)
          ? '<div class="empty-state"><div class="eyebrow">Nenhum talento</div>Nenhum talento encontrado para essa busca.</div>'
          : '<div class="empty-state"><div class="eyebrow">Nenhum talento</div>Cadastre a primeira pessoa para começar o seu banco de talentos.</div>';
        return;
      }
      wrap.innerHTML = `
        <p class="text-sm muted" style="margin:0 0 8px 0;">${talents.length === 1 ? '1 talento' : `${talents.length} talentos`}</p>
        <div class="table-wrap"><table class="talent-table">
          <thead><tr><th>Nome</th><th>Disciplinas</th><th>Contato</th><th>Valor/hora (pretensão)</th><th>Currículo</th></tr></thead>
          <tbody>
            ${talents.map((t) => `
              <tr class="row-link" data-id="${t.id}">
                <td><strong>${escapeHtml(t.name)}</strong></td>
                <td>${subjectBadges(t.subjects) || '<span class="muted text-sm">—</span>'}</td>
                <td>${t.phone ? `<div>${escapeHtml(t.phone)}</div>` : ''}${t.email ? `<div class="talent-cell-sub">${escapeHtml(t.email)}</div>` : ''}${!t.phone && !t.email ? '<span class="muted text-sm">—</span>' : ''}</td>
                <td>${ratesCell(t)}</td>
                <td>${t.cv ? `<span class="badge badge-confirmed">${escapeHtml((t.cv.ext || 'arquivo').toUpperCase())}</span>` : '<span class="muted text-sm">—</span>'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>
      `;
      wrap.querySelectorAll('tr[data-id]').forEach((tr) => {
        tr.addEventListener('click', () => { location.hash = `#/talentos/${tr.dataset.id}`; });
      });
    }

    function ratesCell(t) {
      const parts = [];
      if (t.hourly_rate_presencial !== null && t.hourly_rate_presencial !== undefined) parts.push(`Presencial ${formatCurrency(t.hourly_rate_presencial)}`);
      if (t.hourly_rate_online !== null && t.hourly_rate_online !== undefined) parts.push(`Online ${formatCurrency(t.hourly_rate_online)}`);
      if (parts.length === 0) return '<span class="muted text-sm">—</span>';
      return parts.map((p) => `<div class="tabular" style="white-space:nowrap;">${escapeHtml(p)}</div>`).join('');
    }

    let debounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(loadList, 250);
    });
    subjectSelect.addEventListener('change', loadList);
    loadList();
  };

  // ---------------------------------------------------------------------------------------------
  // Ficha
  // ---------------------------------------------------------------------------------------------

  Pages.talentDetail = async function (root, id) {
    let talent;
    try {
      talent = await api.get(`/api/talents/${encodeURIComponent(id)}`);
    } catch (err) {
      if (err.status !== 404) throw err;
      root.innerHTML = `
        <div class="page-header">
          <div><div class="eyebrow">Talento</div><h1>Talento não encontrado</h1></div>
          <div class="flex gap-10"><a href="#/talentos" class="btn btn-outline">&larr; Voltar</a></div>
        </div>
        <div class="empty-state"><div class="eyebrow">Não encontrado</div>Este talento não existe mais (talvez tenha sido removido).</div>
      `;
      return;
    }
    const config = await api.get('/api/talents/config');

    root.innerHTML = `
      <div class="page-header">
        <div class="talent-wrap"><div class="eyebrow">Talento</div><h1>${escapeHtml(talent.name)}</h1>
          <p class="subtitle">${talent.subjects.map((s) => escapeHtml(s.name)).join(', ') || 'Nenhuma disciplina cadastrada'}</p></div>
        <div class="flex gap-10 wrap">
          <a href="#/talentos" class="btn btn-outline">&larr; Voltar</a>
          <button class="btn btn-danger" id="delete-talent-btn">Remover</button>
        </div>
      </div>
      <div class="card" id="tl-card-dados"></div>
      <div class="card" id="tl-card-cv"></div>
      <div class="card" id="tl-card-notes"></div>
      <div class="card" id="tl-card-avail"></div>
    `;
    // Guarda os próprios elementos desta ficha: se a pessoa abrir outro talento durante um envio, o
    // resultado do envio antigo não aparece na ficha nova.
    const cardDados = root.querySelector('#tl-card-dados');
    const cardCv = root.querySelector('#tl-card-cv');
    const cardNotes = root.querySelector('#tl-card-notes');
    const cardAvail = root.querySelector('#tl-card-avail');

    root.querySelector('#delete-talent-btn').addEventListener('click', async () => {
      const ok = await confirmModal(
        `Remover ${talent.name} do banco de talentos? Os dados, as observações e o currículo anexado serão apagados, e isso não pode ser desfeito.`,
        'Remover talento'
      );
      if (!ok) return;
      try {
        await api.delete(`/api/talents/${talent.id}`);
      } catch (err) {
        showToast(err.message, 'error');
        return;
      }
      showToast('Talento removido.');
      location.hash = '#/talentos';
    });

    // ----- Dados -----
    function renderDados() {
      cardDados.innerHTML = `
        <div class="card-header"><h2>Dados cadastrais</h2>
          <button class="btn btn-outline btn-sm" id="edit-talent-btn">Editar</button></div>
        <div class="field-row">
          <div><div class="text-sm muted">Telefone</div><p class="talent-wrap">${phoneHtml(talent.phone)}</p></div>
          <div><div class="text-sm muted">E-mail</div><p class="talent-wrap">${emailHtml(talent.email)}</p></div>
        </div>
        <div><div class="text-sm muted">Endereço</div><p class="talent-wrap">${escapeHtml(talent.address || '—')}</p></div>
        <div><div class="text-sm muted">Disciplinas</div><p class="talent-wrap">${subjectBadges(talent.subjects) || '—'}</p></div>
        <div class="field-row">
          <div><div class="text-sm muted">Valor/hora pretendido — Presencial</div><p class="tabular">${moneyOrDash(talent.hourly_rate_presencial)}</p></div>
          <div><div class="text-sm muted">Valor/hora pretendido — Online</div><p class="tabular">${moneyOrDash(talent.hourly_rate_online)}</p></div>
        </div>
        <div><div class="text-sm muted">Cadastrado em</div><p class="mb-0">${escapeHtml(formatDate(talent.created_at))}</p></div>
      `;
      cardDados.querySelector('#edit-talent-btn').addEventListener('click', () => {
        talentFormModal(talent, () => Pages.talentDetail(root, id));
      });
    }

    // ----- Currículo -----
    let cvState = { busy: false, pct: 0, error: '' };

    function renderCv() {
      const cv = talent.cv;
      let body;
      if (cvState.busy) {
        body = `
          <p class="text-sm muted mt-0" data-cv-status>Enviando… ${cvState.pct}%</p>
          <div class="mat-progress"><i style="width:${cvState.pct}%"></i></div>`;
      } else if (cv) {
        const actions = [];
        if (cv.inline_ok) actions.push(`<a class="btn btn-outline btn-sm" href="/api/talents/${talent.id}/cv?inline=1" target="_blank" rel="noopener">Abrir</a>`);
        actions.push(`<a class="btn btn-outline btn-sm" href="/api/talents/${talent.id}/cv" target="_blank" rel="noopener">Baixar</a>`);
        actions.push('<button type="button" class="btn btn-outline btn-sm" data-act="replace">Trocar</button>');
        actions.push('<button type="button" class="btn btn-danger btn-sm" data-act="remove">Remover currículo</button>');
        body = `
          <div class="mat-item">
            <div class="mat-ext ${cvTileClass(cv)}" aria-hidden="true">${escapeHtml((cv.ext || 'arq').toUpperCase())}</div>
            <div class="mat-body">
              <div class="mat-title">${escapeHtml(cv.file_name)}</div>
              <div class="mat-meta">${escapeHtml(sizeText(cv.size))} · enviado em ${escapeHtml(formatDate(cv.uploaded_at))}</div>
            </div>
            <div class="mat-actions">${actions.join('')}</div>
          </div>`;
      } else {
        body = `
          <p class="muted mt-0">Nenhum currículo anexado ainda.</p>
          <button type="button" class="btn btn-accent btn-sm" data-act="pick">Anexar currículo</button>`;
      }
      cardCv.innerHTML = `
        <div class="card-header"><h2>Currículo</h2></div>
        ${cvState.error ? `<div class="alert alert-danger" role="alert">${escapeHtml(cvState.error)}</div>` : ''}
        ${body}
        <p class="text-sm muted" style="margin:12px 0 0 0;">${escapeHtml(cvRulesText(config))}</p>
        <input type="file" class="hidden" id="tl-cv-input" accept="${escapeHtml(config.allowedExtensions.map((e) => `.${e}`).join(','))}">
      `;
      const input = cardCv.querySelector('#tl-cv-input');
      cardCv.querySelectorAll('[data-act="pick"], [data-act="replace"]').forEach((b) => b.addEventListener('click', () => input.click()));
      input.addEventListener('change', () => {
        const file = input.files[0];
        input.value = ''; // permite escolher o mesmo arquivo de novo depois
        if (file) uploadCv(file);
      });
      const removeBtn = cardCv.querySelector('[data-act="remove"]');
      if (removeBtn) removeBtn.addEventListener('click', removeCv);
    }

    async function uploadCv(file) {
      const problem = cvProblem(file, config);
      if (problem) { cvState = { busy: false, pct: 0, error: problem }; renderCv(); return; }
      const replacing = !!talent.cv;
      cvState = { busy: true, pct: 0, error: '' };
      renderCv();
      try {
        const saved = await sendCv(talent.id, file, (loaded, total) => {
          const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
          cvState.pct = pct;
          const bar = cardCv.querySelector('.mat-progress > i');
          const label = cardCv.querySelector('[data-cv-status]');
          if (bar) bar.style.width = `${pct}%`;
          if (label) label.textContent = `Enviando… ${pct}%`;
        });
        talent.cv = saved.cv;
        cvState = { busy: false, pct: 0, error: '' };
        renderCv();
        showToast(replacing ? 'Currículo substituído.' : 'Currículo anexado.');
      } catch (err) {
        cvState = { busy: false, pct: 0, error: err.message };
        renderCv();
      }
    }

    async function removeCv() {
      const ok = await confirmModal(`Remover o currículo de ${talent.name}? O arquivo será apagado e isso não pode ser desfeito.`, 'Remover currículo');
      if (!ok) return;
      try {
        await api.delete(`/api/talents/${talent.id}/cv`);
        talent.cv = null;
        cvState = { busy: false, pct: 0, error: '' };
        renderCv();
        showToast('Currículo removido.');
      } catch (err) {
        cvState = { busy: false, pct: 0, error: err.message };
        renderCv();
      }
    }

    // ----- Observações (editadas aqui mesmo, sem abrir o formulário) -----
    let notesEditing = false;

    function renderNotes() {
      if (!notesEditing) {
        cardNotes.innerHTML = `
          <div class="card-header"><h2>Observações</h2>
            <button type="button" class="btn btn-outline btn-sm" data-act="edit-notes">Editar</button></div>
          ${talent.notes
            ? `<p class="talent-notes">${escapeHtml(talent.notes)}</p>`
            : '<p class="muted mt-0 mb-0">Nenhuma observação ainda. Use este espaço para anotar como conheceu a pessoa, impressões da entrevista, o que combinaram…</p>'}
        `;
        cardNotes.querySelector('[data-act="edit-notes"]').addEventListener('click', () => { notesEditing = true; renderNotes(); });
        return;
      }
      cardNotes.innerHTML = `
        <div class="card-header"><h2>Observações</h2></div>
        <textarea id="tl-notes-edit" rows="7" maxlength="${NOTES_MAX}" aria-label="Observações"></textarea>
        <div class="alert alert-danger hidden" id="tl-notes-error" style="margin-top:10px;"></div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" data-act="cancel-notes">Cancelar</button>
          <button type="button" class="btn btn-primary" data-act="save-notes">Salvar observações</button>
        </div>
      `;
      const ta = cardNotes.querySelector('#tl-notes-edit');
      ta.value = talent.notes || '';
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      cardNotes.querySelector('[data-act="cancel-notes"]').addEventListener('click', () => { notesEditing = false; renderNotes(); });
      const saveBtn = cardNotes.querySelector('[data-act="save-notes"]');
      saveBtn.addEventListener('click', async () => {
        const errEl = cardNotes.querySelector('#tl-notes-error');
        errEl.classList.add('hidden');
        saveBtn.disabled = true;
        try {
          // Só as observações vão no pedido: o resto do cadastro não é tocado.
          const saved = await api.put(`/api/talents/${talent.id}`, { notes: ta.value });
          talent.notes = saved.notes;
          notesEditing = false;
          renderNotes();
          showToast('Observações salvas.');
        } catch (err) {
          saveBtn.disabled = false;
          errEl.textContent = err.message;
          errEl.classList.remove('hidden');
        }
      });
    }

    // ----- Disponibilidade -----
    function renderAvail() {
      const any = Object.values(talent.availability_grid || {}).some((hours) => Array.isArray(hours) && hours.length > 0);
      cardAvail.innerHTML = `
        <div class="card-header"><h2>Disponibilidade</h2></div>
        ${any
          ? '<div id="tl-avail-grid" class="talent-avail"></div>'
          : '<p class="muted mt-0 mb-0">Nenhuma disponibilidade informada. Use <strong>Editar</strong> nos dados cadastrais para marcar os horários.</p>'}
      `;
      if (any) AvailabilityGrid.render(cardAvail.querySelector('#tl-avail-grid'), talent.availability_grid, { editable: false });
    }

    renderDados();
    renderCv();
    renderNotes();
    renderAvail();
  };
})();
