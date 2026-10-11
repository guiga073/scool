// public/js/materials-panel.js
// Componente compartilhado de "Materiais de aula". Funciona nos três lugares:
//   - painel da secretaria (ficha do aluno e página "Materiais"): só vê e apaga;
//   - área do professor: vê e envia materiais para cada aluno dele;
//   - área do aluno: vê tudo que recebeu e pode enviar para os professores dele.
// Quem pode o quê é decidido pelo servidor (server/routes/materials.js); aqui a tela só
// mostra/esconde botões e avisa os problemas antes de gastar tempo enviando.

const MaterialsPanel = (function () {
  // ---------- Arquivos: conferência antes do envio ----------

  const LEGACY = { doc: 'docx', ppt: 'pptx', xls: 'xlsx' };
  const MEDIA = ['mp4', 'mov', 'avi', 'mkv', 'wmv', 'webm', 'm4v', '3gp', 'mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac', 'wma'];
  const PACKED = ['zip', 'rar', '7z', 'tar', 'gz'];

  function extOf(name) {
    const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  // Motivo pelo qual o arquivo não pode ser enviado (ou null quando está tudo certo).
  function problemWith(file, config) {
    const ext = extOf(file.name);
    if (!ext || !config.allowedExtensions.includes(ext)) {
      if (LEGACY[ext]) return `Arquivos .${ext} antigos não são aceitos. Abra e salve como .${LEGACY[ext]} (ou PDF) e envie de novo.`;
      if (MEDIA.includes(ext)) return 'Vídeos e áudios não são aceitos aqui (ficam pesados demais). Coloque no YouTube ou no Google Drive e use a opção "Link".';
      if (ext === 'heic' || ext === 'heif') return 'Fotos no formato HEIC não são aceitas. Converta para JPG e envie de novo.';
      if (PACKED.includes(ext)) return 'Arquivos compactados (.zip, .rar…) não são aceitos. Envie os arquivos separados.';
      return `Tipo de arquivo não aceito${ext ? ` (.${ext})` : ''}. Envie PDF, imagem, Word, PowerPoint ou Excel.`;
    }
    if (file.size === 0) return 'O arquivo está vazio.';
    if (file.size > config.maxFileBytes) {
      // Logo acima do limite os dois tamanhos arredondam igual ("50,0 MB" e "50,0 MB"); aí mostra os bytes.
      const shown = formatBytes(file.size) === formatBytes(config.maxFileBytes) ? `${file.size.toLocaleString('pt-BR')} bytes` : formatBytes(file.size);
      return `Grande demais (${shown}); o máximo é ${formatBytes(config.maxFileBytes)}. Para arquivos maiores, use a opção "Link" (YouTube, Google Drive…).`;
    }
    return null;
  }

  function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

  // ---------- Lista de materiais ----------

  function byLine(m, viewer) {
    let who;
    if (viewer === 'teacher') who = m.uploader_type === 'teacher' ? 'você' : `${escapeHtml(m.uploader_name)} (aluno)`;
    else if (viewer === 'student') who = m.uploader_type === 'student' ? 'você' : `${escapeHtml(m.uploader_name)} (professor)`;
    else who = `${escapeHtml(m.uploader_name)} (${m.uploader_type === 'teacher' ? 'professor' : 'aluno'})`;
    return `Enviado por ${who} em ${escapeHtml(formatDateTime(m.created_at))}`;
  }

  function itemHtml(m, o) {
    const id = Number(m.id);
    const isLink = m.kind === 'link';
    const label = isLink ? 'LINK' : String(m.ext || '').toUpperCase();
    const kindClass = isLink ? 'mat-ext-link' : m.ext === 'pdf' ? 'mat-ext-pdf' : m.image ? 'mat-ext-img' : 'mat-ext-doc';
    const detail = isLink
      ? `<div class="mat-meta">${materialLinkHtml(m.url)}</div>`
      : `<div class="mat-meta">${escapeHtml(m.file_name)} · ${formatBytes(m.size)}</div>`;
    const people = o.showPeople
      ? `<div class="mat-meta">Aluno: <a href="#/alunos/${Number(m.student_id)}">${escapeHtml(m.student_name)}</a> · Professor: ${escapeHtml(m.teacher_name)}</div>`
      : '';
    const actions = [];
    if (!isLink) {
      actions.push(`<a class="btn btn-outline btn-sm" href="/api/materials/${id}/download" target="_blank" rel="noopener">Baixar</a>`);
      if (m.image) actions.push(`<a class="btn btn-outline btn-sm" href="/api/materials/${id}/download?inline=1" target="_blank" rel="noopener">Abrir</a>`);
    }
    if (m.can_delete) actions.push(`<button type="button" class="btn btn-danger btn-sm" data-del="${id}">Apagar</button>`);
    return `
      <div class="mat-item" data-id="${id}">
        <div class="mat-ext ${kindClass}" aria-hidden="true">${escapeHtml(label)}</div>
        <div class="mat-body">
          <div class="mat-title">${escapeHtml(m.title)}</div>
          ${detail}
          ${people}
          <div class="mat-by">${byLine(m, o.viewer)}</div>
          ${m.note ? `<p class="mat-note">${escapeHtml(m.note)}</p>` : ''}
        </div>
        ${actions.length ? `<div class="mat-actions">${actions.join('')}</div>` : ''}
      </div>`;
  }

  // Desenha a lista (agrupada por professor, quando pedido) e liga o botão "Apagar".
  // o: { viewer, showPeople, groupByTeacher, emptyHtml, onChanged }
  function renderItems(listEl, items, o) {
    if (items.length === 0) {
      listEl.innerHTML = `<div class="empty-state">${o.emptyHtml || 'Nenhum material ainda.'}</div>`;
      return;
    }
    if (o.groupByTeacher) {
      const groups = new Map();
      for (const m of items) {
        if (!groups.has(m.teacher_id)) groups.set(m.teacher_id, { name: m.teacher_name, items: [] });
        groups.get(m.teacher_id).items.push(m);
      }
      listEl.innerHTML = Array.from(groups.values()).map((g) => `
        <h3 class="mat-group-title">Professor: ${escapeHtml(g.name)} <span class="muted text-sm">(${g.items.length})</span></h3>
        <div class="mat-list">${g.items.map((m) => itemHtml(m, o)).join('')}</div>`).join('');
    } else {
      listEl.innerHTML = `<div class="mat-list">${items.map((m) => itemHtml(m, o)).join('')}</div>`;
    }
    listEl.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const m = items.find((x) => x.id === Number(btn.dataset.del));
        const ok = await confirmModal(`Apagar "${m ? m.title : 'este material'}"? Ele deixa de aparecer para todos e o arquivo é excluído. Essa ação não pode ser desfeita.`, 'Apagar');
        if (!ok) return;
        btn.disabled = true;
        try {
          await api.delete(`/api/materials/${btn.dataset.del}`);
          showToast('Material apagado.');
        } catch (err) {
          showToast(err.message, 'error');
          btn.disabled = false;
          return;
        }
        if (o.onChanged) o.onChanged();
      });
    });
  }

  // ---------- Caixa de envio (professor e aluno) ----------

  function renderUploadBox(slot, ctx, config, targets, onUploaded) {
    const viewer = ctx.viewer;
    if (viewer === 'admin') {
      slot.innerHTML = '<p class="text-sm muted">Os materiais são enviados pelos professores e pelo próprio aluno. Aqui a secretaria vê e apaga o que for preciso.</p>';
      return;
    }
    if (viewer === 'student' && !config.studentUploads) {
      slot.innerHTML = '<div class="alert alert-info">O envio de materiais pelos alunos está desligado no momento. Seus professores podem enviar materiais para você, e eles aparecem aqui.</div>';
      return;
    }
    if (viewer === 'student' && targets.length === 0) {
      slot.innerHTML = '<div class="alert alert-info">Você ainda não tem aulas agendadas com um professor, então ainda não dá para enviar materiais.</div>';
      return;
    }

    const uid = Math.random().toString(36).slice(2, 8);
    const accept = config.allowedExtensions.map((e) => `.${e}`).join(',');
    const state = { mode: 'file', queue: [], busy: false, batchSize: 0, controller: null, nextId: 1, remaining: config.remainingBytes };

    const targetHtml = viewer === 'student'
      ? (targets.length === 1
        ? `<p class="mat-target">Para: <strong>${escapeHtml(targets[0].name)}</strong></p>`
        : `<div class="field"><label for="mat-target-${uid}">Para qual professor?</label>
             <select id="mat-target-${uid}" data-target>${targets.map((t) => `<option value="${Number(t.id)}">${escapeHtml(t.name)}</option>`).join('')}</select></div>`)
      : `<p class="mat-target">Para: <strong>${escapeHtml(ctx.studentName)}</strong></p>`;

    slot.innerHTML = `
      <div class="mat-box" data-box>
        <div class="flex-between mat-box-head">
          <h3>Enviar material</h3>
          <div class="pill-toggle" data-modes>
            <button type="button" class="active" data-mode="file">Arquivo</button>
            <button type="button" data-mode="link">Link</button>
          </div>
        </div>
        ${targetHtml}
        ${config.storageFull ? '<div class="alert alert-danger">O armazenamento de materiais está cheio, então não dá para enviar arquivos agora. Avise a secretaria. Links ainda podem ser salvos.</div>' : ''}

        <div data-pane="file">
          <div class="mat-picker">
            <button type="button" class="btn btn-accent" data-choose ${config.storageFull ? 'disabled' : ''}>Escolher arquivos</button>
            <span class="mat-drop-hint">ou arraste para cá</span>
            <input type="file" class="hidden" data-file multiple accept="${escapeHtml(accept)}">
          </div>
          <ul class="mat-queue" data-queue></ul>
          <div data-file-fields class="hidden">
            <div class="field" data-title-wrap><label for="mat-title-${uid}">Título (opcional)</label>
              <input type="text" id="mat-title-${uid}" data-title maxlength="120" placeholder="Ex.: Lista de exercícios"></div>
            <div class="field"><label for="mat-note-${uid}">Observação (opcional)</label>
              <textarea id="mat-note-${uid}" data-note maxlength="500" rows="2" placeholder="Ex.: Fazer os exercícios 1 a 10 até sexta."></textarea></div>
          </div>
          <div class="form-actions mat-send-row">
            <button type="button" class="btn btn-outline hidden" data-cancel>Cancelar envio</button>
            <button type="button" class="btn btn-primary" data-send disabled>Enviar</button>
          </div>
        </div>

        <div data-pane="link" class="hidden">
          <div class="field"><label for="mat-url-${uid}">Endereço do link</label>
            <input type="text" id="mat-url-${uid}" data-url inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Cole o link aqui">
            <div class="hint" data-url-hint></div></div>
          <div class="field"><label for="mat-ltitle-${uid}">Título (opcional)</label>
            <input type="text" id="mat-ltitle-${uid}" data-link-title maxlength="120" placeholder="Ex.: Vídeo-aula"></div>
          <div class="field"><label for="mat-lnote-${uid}">Observação (opcional)</label>
            <textarea id="mat-lnote-${uid}" data-link-note maxlength="500" rows="2"></textarea></div>
          <div class="form-actions"><button type="button" class="btn btn-primary" data-send-link>Salvar link</button></div>
        </div>

        <p class="text-sm muted mat-rules">Aceitamos PDF, imagens (JPG, PNG, GIF, WEBP), Word (.docx), PowerPoint (.pptx) e Excel (.xlsx), de até ${escapeHtml(formatBytes(config.maxFileBytes))} cada. Vídeos e arquivos maiores: use a opção <strong>Link</strong> (YouTube, Google Drive…). No celular, deixe a tela aberta até o envio terminar.</p>
      </div>`;

    const box = slot.querySelector('[data-box]');
    const $ = (sel) => box.querySelector(sel);
    const fileInput = $('[data-file]');
    const queueEl = $('[data-queue]');
    const sendBtn = $('[data-send]');
    const cancelBtn = $('[data-cancel]');
    const fieldsEl = $('[data-file-fields]');
    const titleWrap = $('[data-title-wrap]');
    const titleInput = $('[data-title]');
    const noteInput = $('[data-note]');

    function selectedTeacherId() {
      if (viewer !== 'student') return null;
      const sel = $('[data-target]');
      return sel ? Number(sel.value) : Number(targets[0].id);
    }

    function readyCount() { return state.queue.filter((q) => q.status === 'ready').length; }

    function metaText(q) {
      if (q.status === 'invalid' || q.status === 'error') return escapeHtml(q.error || 'Não foi possível enviar.');
      if (q.status === 'done') return 'Enviado ✓';
      if (q.status === 'uploading') {
        if (q.total && q.loaded >= q.total) return 'Finalizando…';
        const pct = q.total ? Math.floor((q.loaded / q.total) * 100) : 0;
        return `Enviando… ${pct}% (${formatBytes(q.loaded)} de ${formatBytes(q.total || q.file.size)})`;
      }
      return state.busy ? 'Na fila' : `${formatBytes(q.file.size)} · pronto para enviar`;
    }

    function renderQueue() {
      queueEl.innerHTML = state.queue.map((q) => {
        const bad = q.status === 'invalid' || q.status === 'error';
        const pct = q.total ? Math.floor((q.loaded / q.total) * 100) : 0;
        return `
          <li class="mat-q-row${bad ? ' bad' : ''}" data-qid="${q.id}">
            <div class="mat-q-name">${escapeHtml(q.file.name)}</div>
            ${state.busy ? '' : `<div class="mat-q-btns">${q.retryable ? `<button type="button" class="btn-text" data-retry="${q.id}" aria-label="Tentar enviar de novo ${escapeHtml(q.file.name)}">Tentar de novo</button>` : ''}<button type="button" class="btn-text" data-rm="${q.id}" aria-label="Remover ${escapeHtml(q.file.name)}">Remover</button></div>`}
            <div class="mat-q-meta${bad ? ' err' : ''}" data-meta>${metaText(q)}</div>
            ${q.status === 'uploading' ? `<div class="mat-progress"><i style="width:${pct}%"></i></div>` : ''}
          </li>`;
      }).join('');
      queueEl.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
        state.queue = state.queue.filter((q) => q.id !== Number(b.dataset.rm));
        renderQueue();
      }));
      // Falha de conexão (ou do servidor): o arquivo volta a "pronto para enviar" e a pessoa aperta Enviar de novo.
      queueEl.querySelectorAll('[data-retry]').forEach((b) => b.addEventListener('click', () => {
        const q = state.queue.find((x) => x.id === Number(b.dataset.retry));
        if (q) { q.status = 'ready'; q.error = null; q.retryable = false; q.loaded = 0; q.total = 0; }
        renderQueue();
      }));
      const n = readyCount();
      fieldsEl.classList.toggle('hidden', n === 0 && !state.busy);
      titleWrap.classList.toggle('hidden', (state.busy ? state.batchSize : n) !== 1);
      titleInput.disabled = state.busy;
      noteInput.disabled = state.busy;
      sendBtn.disabled = state.busy || n === 0 || !!config.storageFull;
      sendBtn.textContent = n > 1 ? `Enviar ${n} arquivos` : 'Enviar';
      cancelBtn.classList.toggle('hidden', !state.busy);
      box.classList.toggle('busy', state.busy);
    }

    function updateProgress(q) {
      const row = queueEl.querySelector(`[data-qid="${q.id}"]`);
      if (!row) return;
      const bar = row.querySelector('.mat-progress > i');
      if (bar) bar.style.width = `${q.total ? Math.floor((q.loaded / q.total) * 100) : 0}%`;
      const meta = row.querySelector('[data-meta]');
      if (meta) meta.textContent = metaText(q);
    }

    function addFiles(fileList) {
      for (const file of Array.from(fileList || [])) {
        if (state.queue.some((q) => q.file.name === file.name && q.file.size === file.size && q.file.lastModified === file.lastModified)) continue;
        const problem = problemWith(file, config);
        state.queue.push({ id: state.nextId++, file, status: problem ? 'invalid' : 'ready', error: problem, loaded: 0, total: 0 });
      }
      renderQueue();
    }

    const unloadWarning = (e) => { e.preventDefault(); e.returnValue = ''; };

    async function startUpload() {
      const ready = state.queue.filter((q) => q.status === 'ready');
      if (ready.length === 0 || state.busy) return;
      const teacherId = selectedTeacherId();
      const query = viewer === 'teacher' ? `studentId=${encodeURIComponent(ctx.studentId)}` : `teacherId=${encodeURIComponent(teacherId)}`;
      const note = noteInput.value.trim();
      const title = ready.length === 1 ? titleInput.value.trim() : '';

      state.busy = true;
      state.batchSize = ready.length;
      window.addEventListener('beforeunload', unloadWarning);
      renderQueue();
      let sent = 0;
      let failed = 0;
      let cancelled = false;
      for (const q of ready) {
        if (cancelled) break;
        if (q.file.size > state.remaining) {
          q.status = 'error';
          q.error = 'Não há espaço suficiente no armazenamento de materiais para este arquivo. Avise a secretaria.';
          failed++;
          renderQueue();
          continue;
        }
        q.status = 'uploading';
        q.loaded = 0;
        q.total = q.file.size;
        renderQueue();
        state.controller = new AbortController();
        const headers = { 'X-File-Name': encodeURIComponent(q.file.name) };
        if (title) headers['X-Title'] = encodeURIComponent(title);
        if (note) headers['X-Note'] = encodeURIComponent(note);
        let raf = 0;
        try {
          await api.upload(`/api/materials/file?${query}`, q.file, {
            headers,
            signal: state.controller.signal,
            onProgress: (loaded, total) => {
              q.loaded = loaded; q.total = total;
              if (!raf) raf = requestAnimationFrame(() => { raf = 0; updateProgress(q); });
            },
          });
          q.status = 'done';
          state.remaining -= q.file.size;
          sent++;
        } catch (err) {
          if (err.status === 401) { window.location.href = '/login.html'; return; }
          if (err.aborted) { q.status = 'ready'; cancelled = true; } else { q.status = 'error'; q.error = err.message; q.retryable = !!err.network || err.status === 408 || err.status >= 500; failed++; }
        }
        renderQueue();
      }
      state.busy = false;
      state.controller = null;
      window.removeEventListener('beforeunload', unloadWarning);
      state.queue = state.queue.filter((q) => q.status !== 'done');
      if (state.queue.length === 0) { titleInput.value = ''; noteInput.value = ''; }
      renderQueue();
      if (sent > 0) showToast(sent === 1 ? 'Material enviado.' : `${sent} materiais enviados.`);
      if (failed > 0) showToast(failed === 1 ? 'Um arquivo não foi enviado. Veja o motivo na lista.' : `${failed} arquivos não foram enviados. Veja o motivo na lista.`, 'error');
      if (cancelled) showToast('Envio cancelado.');
      if (sent > 0) onUploaded();
    }

    // Arquivo / Link
    box.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.busy) return;
        state.mode = btn.dataset.mode;
        box.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b === btn));
        box.querySelector('[data-pane="file"]').classList.toggle('hidden', state.mode !== 'file');
        box.querySelector('[data-pane="link"]').classList.toggle('hidden', state.mode !== 'link');
      });
    });

    $('[data-choose]').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
    sendBtn.addEventListener('click', startUpload);
    cancelBtn.addEventListener('click', () => { if (state.controller) state.controller.abort(); });

    // Arrastar e soltar (computador)
    let dragDepth = 0;
    box.addEventListener('dragenter', (e) => { if (state.busy || state.mode !== 'file') return; e.preventDefault(); dragDepth++; box.classList.add('mat-drop-active'); });
    box.addEventListener('dragover', (e) => { if (state.busy || state.mode !== 'file') return; e.preventDefault(); });
    box.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0) box.classList.remove('mat-drop-active'); });
    box.addEventListener('drop', (e) => {
      dragDepth = 0;
      box.classList.remove('mat-drop-active');
      if (state.busy || state.mode !== 'file') return;
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files && !config.storageFull) addFiles(e.dataTransfer.files);
    });

    // Link
    const urlInput = $('[data-url]');
    const urlHint = $('[data-url-hint]');
    urlInput.addEventListener('input', () => {
      urlHint.classList.remove('hint-error');
      urlInput.removeAttribute('aria-invalid');
      if (!urlInput.value.trim()) { urlHint.textContent = ''; return; }
      const r = normalizeMaterialLink(urlInput.value);
      if (!r.ok) { urlHint.textContent = r.error; urlHint.classList.add('hint-error'); urlInput.setAttribute('aria-invalid', 'true'); return; }
      urlHint.textContent = r.changed ? `Será salvo como ${r.value}` : '';
    });
    const sendLinkBtn = $('[data-send-link]');
    sendLinkBtn.addEventListener('click', async () => {
      const r = normalizeMaterialLink(urlInput.value);
      if (!r.ok || !r.value) {
        urlHint.textContent = r.ok ? 'Informe o endereço do link.' : r.error;
        urlHint.classList.add('hint-error');
        urlInput.setAttribute('aria-invalid', 'true');
        urlInput.focus();
        return;
      }
      const body = {
        url: r.value,
        title: $('[data-link-title]').value.trim(),
        note: $('[data-link-note]').value.trim(),
      };
      if (viewer === 'teacher') body.studentId = ctx.studentId; else body.teacherId = selectedTeacherId();
      sendLinkBtn.disabled = true;
      try {
        await api.post('/api/materials/link', body);
        showToast('Link salvo.');
        urlInput.value = ''; urlHint.textContent = '';
        $('[data-link-title]').value = ''; $('[data-link-note]').value = '';
        onUploaded();
      } catch (err) {
        if (err.status === 401) { window.location.href = '/login.html'; return; }
        urlHint.textContent = err.message;
        urlHint.classList.add('hint-error');
      } finally {
        sendLinkBtn.disabled = false;
      }
    });

    renderQueue();
  }

  // ---------- Montagem do painel ----------

  // container: elemento DOM.
  // opts: { viewer: 'admin'|'teacher'|'student', studentId, studentName, title, onBack }
  async function mount(container, opts) {
    const viewer = opts.viewer;
    const ctx = { viewer, studentId: opts.studentId, studentName: opts.studentName || '' };
    container.innerHTML = '<div class="loading-dots">Carregando…</div>';

    let config;
    let targets = [];
    try {
      config = await api.get('/api/materials/config');
      if (viewer === 'student') targets = await api.get('/api/materials/targets');
    } catch (err) {
      if (err.status === 401) { window.location.href = '/login.html'; return; }
      container.innerHTML = `<div class="alert alert-danger">Não foi possível carregar os materiais: ${escapeHtml(err.message)}</div>`;
      return;
    }

    container.innerHTML = `
      <div class="mat-panel">
        <div class="card-header">
          <div class="flex gap-10 wrap" style="align-items:center;">
            ${opts.onBack ? '<button type="button" class="btn btn-outline btn-sm" data-back>&larr; Todos os alunos</button>' : ''}
            <h2 style="margin:0;">${escapeHtml(opts.title || 'Materiais de aula')}</h2>
          </div>
          <div data-header-actions></div>
        </div>
        <div data-slot="upload"></div>
        <div data-slot="list"></div>
      </div>`;
    if (opts.onBack) container.querySelector('[data-back]').addEventListener('click', opts.onBack);
    const listEl = container.querySelector('[data-slot="list"]');
    const actionsEl = container.querySelector('[data-header-actions]');

    async function loadList() {
      let items;
      try {
        items = await api.get('/api/materials' + (viewer === 'student' ? '' : `?studentId=${encodeURIComponent(ctx.studentId)}`));
      } catch (err) {
        if (err.status === 401) { window.location.href = '/login.html'; return; }
        listEl.innerHTML = `<div class="alert alert-danger">Não foi possível carregar a lista: ${escapeHtml(err.message)}</div>`;
        return;
      }
      const emptyHtml = viewer === 'student'
        ? '<div class="eyebrow">Nada por aqui ainda</div>Quando um professor enviar um material (ou você mesmo enviar), ele aparece aqui.'
        : `<div class="eyebrow">Nada por aqui ainda</div>Nenhum material compartilhado${ctx.studentName ? ` com ${escapeHtml(ctx.studentName)}` : ''} até agora.`;
      renderItems(listEl, items, {
        viewer,
        groupByTeacher: viewer !== 'teacher',
        emptyHtml,
        onChanged: loadList,
      });

      // Secretaria: apagar tudo de um aluno de uma vez.
      actionsEl.innerHTML = viewer === 'admin' && items.length > 0
        ? '<button type="button" class="btn btn-danger btn-sm" data-wipe>Apagar todos os materiais deste aluno</button>' : '';
      const wipe = actionsEl.querySelector('[data-wipe]');
      if (wipe) {
        wipe.addEventListener('click', async () => {
          const files = items.filter((m) => m.kind === 'file');
          const bytes = files.reduce((s, m) => s + m.size, 0);
          const ok = await confirmModal(
            `Apagar TODOS os materiais de ${ctx.studentName || 'este aluno'}? Serão excluídos ${plural(files.length, 'arquivo', 'arquivos')} (${formatBytes(bytes)}) e ${plural(items.length - files.length, 'link', 'links')}, de todos os professores. Essa ação não pode ser desfeita.`,
            'Apagar tudo'
          );
          if (!ok) return;
          wipe.disabled = true;
          try {
            const r = await api.delete(`/api/students/${ctx.studentId}/materials`);
            showToast(`${plural(r.count, 'material apagado', 'materiais apagados')} — ${formatBytes(r.freedBytes)} liberados.`);
          } catch (err) {
            showToast(err.message, 'error');
          }
          loadList();
        });
      }
    }

    renderUploadBox(container.querySelector('[data-slot="upload"]'), ctx, config, targets, loadList);
    await loadList();
  }

  // Professor: lista dos alunos dele; clicar abre os materiais daquele aluno.
  async function renderStudentPicker(container, onPick) {
    container.innerHTML = '<div class="loading-dots">Carregando…</div>';
    let students;
    try {
      students = await api.get('/api/materials/targets');
    } catch (err) {
      if (err.status === 401) { window.location.href = '/login.html'; return; }
      container.innerHTML = `<div class="alert alert-danger">Não foi possível carregar seus alunos: ${escapeHtml(err.message)}</div>`;
      return;
    }
    if (students.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="eyebrow">Nenhum aluno ainda</div>Assim que houver uma aula agendada com um aluno, ele aparece aqui.</div>';
      return;
    }
    container.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Aluno</th><th></th></tr></thead>
        <tbody>${students.map((s) => `<tr class="row-link" data-id="${Number(s.id)}"><td><strong>${escapeHtml(s.name)}</strong></td><td class="muted text-sm">Ver materiais &rarr;</td></tr>`).join('')}</tbody>
      </table></div>`;
    container.querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.addEventListener('click', () => onPick(students.find((s) => String(s.id) === tr.dataset.id)));
    });
  }

  return { mount, renderStudentPicker, renderItems, problemWith, plural };
})();
