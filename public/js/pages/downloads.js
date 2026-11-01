// public/js/pages/downloads.js
// Painel "Downloads (Manual)" (só administração): quem baixou o material gratuito do site, números e o arquivo.
// Rotas: #/downloads, #/downloads/pessoas, #/downloads/material
// As regras ficam no servidor (server/freebies.js); aqui é só a tela.

(function () {
  const TABS = [['geral', 'Visão geral'], ['pessoas', 'Pessoas'], ['material', 'Material']];
  const STATUS = [['novo', 'Novo'], ['contatado', 'Contatado'], ['virou_aluno', 'Virou aluno'], ['sem_interesse', 'Sem interesse']];
  const pct = (x) => `${Math.round((x || 0) * 100)}%`;

  function statusBadge(p) {
    const cls = { novo: 'badge-pending', contatado: 'badge-confirmed', virou_aluno: 'badge-confirmed', sem_interesse: 'badge-neutral' }[p.status] || 'badge-neutral';
    return `<span class="badge ${cls}">${escapeHtml(p.status_label)}</span>`;
  }
  function consentBadge(p) {
    return p.contact_consent ? '<span class="badge badge-confirmed">autorizou contato</span>' : '<span class="badge badge-neutral">sem autorização de contato</span>';
  }
  function copy(text, okMsg) {
    const done = () => showToast(okMsg || 'Copiado.');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => window.prompt('Copie:', text));
    else window.prompt('Copie:', text);
  }
  function waLink(p) {
    const first = p.name.split(' ')[0];
    const msg = `Olá, ${first}! Aqui é da OLIMAIS. Vimos que você baixou o nosso Manual do ENEM — conseguiu aproveitar? Se quiser ajuda nos estudos, temos aulas particulares online e presenciais.`;
    return `https://wa.me/${encodeURIComponent(p.phone)}?text=${encodeURIComponent(msg)}`;
  }

  Pages.downloads = async function (root, tabId) {
    const tab = TABS.some((t) => t[0] === tabId) ? tabId : 'geral';
    root.innerHTML = `
      <div class="page-header"><div><div class="eyebrow">Material gratuito do site</div><h1>Downloads do Manual</h1>
        <p class="muted text-sm" style="margin:4px 0 0;">Quem baixou o material gratuito (nome, e-mail e celular), para a equipe entrar em contato e transformar em alunos.</p></div></div>
      <div class="store-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" class="${k === tab ? 'active' : ''}" aria-selected="${k === tab}">${l}</button>`).join('')}</div>
      <div id="dl-body"><div class="loading-dots">Carregando…</div></div>`;
    root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.tab === 'geral' ? '#/downloads' : `#/downloads/${b.dataset.tab}`; }));
    const body = root.querySelector('#dl-body');
    if (tab === 'geral') await renderOverview(body);
    else if (tab === 'pessoas') await renderPeople(body);
    else await renderMaterial(body);
  };

  // ---------- Visão geral ----------

  async function renderOverview(el) {
    const s = await api.get('/api/admin/downloads/resumo');
    const m = s.materials[0];
    const steps = [];
    if (m && !m.has_file) steps.push('Enviar o PDF do manual (aba <a href="#/downloads/material">Material</a>).');
    if (m && !m.active) steps.push('<strong>Liberar os downloads</strong> (aba <a href="#/downloads/material">Material</a>).');
    if (m && m.active === true && s.people === 0) steps.push('Publicar o site com a página do manual e divulgar o link.');
    const maxW = Math.max(1, ...s.weeks.map((w) => w.n));
    const st = s.by_status;
    const bars = (list, label) => list.length ? `<ul class="store-check">${list.map((x) => `<li><div style="flex:1">${escapeHtml(label(x))}</div><strong class="tabular">${x.n}</strong></li>`).join('')}</ul>` : '<p class="text-sm muted">Ainda sem dados.</p>';
    el.innerHTML = `
      ${steps.length ? `<div class="alert alert-info"><div><strong>Para começar:</strong><ol style="margin:6px 0 0 18px;padding:0;">${steps.map((x) => `<li>${x}</li>`).join('')}</ol></div></div>` : ''}
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">Pessoas cadastradas</div><div class="stat-value tabular">${s.people}</div><div class="text-sm muted">${s.people_this_month} neste mês · ${s.people_prev_month} no mês passado</div></div>
        <div class="stat-card"><div class="stat-label">Downloads do arquivo</div><div class="stat-value accent tabular">${s.files_downloaded}</div><div class="text-sm muted">${s.files_this_month} neste mês</div></div>
        <div class="stat-card"><div class="stat-label">Autorizaram contato</div><div class="stat-value confirmed tabular">${s.consent}</div><div class="text-sm muted">${pct(s.consent_rate)} das pessoas</div></div>
        <div class="stat-card"><div class="stat-label">Viraram alunos</div><div class="stat-value tabular">${st.virou_aluno}</div><div class="text-sm muted">conversão de ${pct(s.conversion_rate)}</div></div>
      </div>
      ${s.to_contact ? `<div class="alert alert-warn"><div><strong>${s.to_contact}</strong> pessoa(s) autorizaram contato e ainda estão como "Novo". <a href="#/downloads/pessoas">Ver quem são</a>.</div></div>` : ''}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">
        <div class="card"><div class="card-header"><h2>Novas pessoas por semana</h2></div>
          <div class="store-bars">${s.weeks.map((w) => `<div class="bar" title="semana de ${escapeHtml(formatDate(w.start))}"><b class="tabular">${w.n}</b><i style="height:${Math.round((w.n / maxW) * 80)}px"></i>${escapeHtml(formatDate(w.start).slice(0, 5).replace(/^0/, '').replace('/0', '/'))}</div>`).join('')}</div>
          <p class="text-sm muted" style="margin:10px 0 0;">${s.requests} pedido(s) de download no total; ${s.requests_used} deles chegaram a baixar o arquivo.</p>
        </div>
        <div class="card"><div class="card-header"><h2>Acompanhamento</h2></div>
          ${bars(STATUS.map(([k, l]) => ({ k, l, n: st[k] || 0 })), (x) => x.l)}
        </div>
        <div class="card"><div class="card-header"><h2>De onde vieram</h2></div>
          ${bars(s.sources, (x) => x.source || 'direto')}
          <p class="text-sm muted" style="margin:8px 0 0;">Para saber de onde vem cada pessoa, divulgue o link com <span class="store-code nowrap">?origem=instagram</span>, <span class="store-code nowrap">?origem=whatsapp</span> etc.</p>
        </div>
        <div class="card"><div class="card-header"><h2>Estados (pelo DDD)</h2></div>
          ${bars(s.states, (x) => x.uf === 'outro' ? 'Outros / exterior' : x.uf)}
        </div>
      </div>
      <div class="card"><div class="card-header"><h2>Últimos cadastros</h2><a class="btn btn-outline btn-sm" href="#/downloads/pessoas">Ver todos</a></div>
        ${s.recent.length ? `<div class="table-wrap"><table><tbody>${s.recent.map((p) => `<tr class="row-link" data-id="${p.id}">
          <td><strong>${escapeHtml(p.name)}</strong><div class="text-sm muted">${escapeHtml(formatDateTime(p.created_at))}</div></td>
          <td class="text-sm">${escapeHtml(p.phone_display)}<div class="muted">${escapeHtml(p.email)}</div></td><td>${statusBadge(p)}</td></tr>`).join('')}</tbody></table></div>`
          : '<div class="empty-state">Ninguém baixou ainda.</div>'}
      </div>`;
    el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => openPerson(Number(tr.dataset.id), () => renderOverview(el))));
  }

  // ---------- Pessoas ----------

  async function renderPeople(el) {
    const state = { q: '', status: '', consent: '' };
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h2>Pessoas que baixaram</h2>
          <div class="flex gap-10 wrap"><a class="btn btn-outline btn-sm" href="/api/admin/downloads/pessoas.csv">Exportar planilha (CSV)</a></div></div>
        <div class="store-filters">
          <input type="search" id="pp-q" placeholder="Buscar por nome, e-mail, celular ou observação" aria-label="Buscar pessoas">
          <select id="pp-status" aria-label="Filtrar por situação"><option value="">Todas as situações</option>${STATUS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
          <select id="pp-consent" aria-label="Filtrar por autorização de contato"><option value="">Com e sem autorização de contato</option><option value="sim">Autorizaram contato</option><option value="nao">Não autorizaram</option></select>
        </div>
        <div id="pp-list"><div class="loading-dots">Carregando…</div></div>
      </div>`;
    const list = el.querySelector('#pp-list');
    async function load() {
      const r = await api.get(`/api/admin/downloads/pessoas?${new URLSearchParams(state)}`);
      if (!r.items.length) { list.innerHTML = '<div class="empty-state">Ninguém encontrado.</div>'; return; }
      list.innerHTML = `<p class="text-sm muted">${r.total} pessoa(s). <button type="button" class="btn-text" id="pp-copy-wa">Copiar celulares (só de quem autorizou contato)</button> · <button type="button" class="btn-text" id="pp-copy-em">Copiar e-mails (só de quem autorizou contato)</button></p>
        <div class="table-wrap"><table>
        <thead><tr><th>Cadastro</th><th>Nome</th><th>Contato</th><th>Origem</th><th>Downloads</th><th>Situação</th></tr></thead>
        <tbody>${r.items.map((p) => `<tr class="row-link" data-id="${p.id}">
          <td class="text-sm">${escapeHtml(formatDateTime(p.created_at))}</td>
          <td><strong>${escapeHtml(p.name)}</strong>${p.lead_id ? ' <span class="badge badge-neutral">nos Interessados</span>' : ''}</td>
          <td class="text-sm">${escapeHtml(p.phone_display)}${p.uf ? ` <span class="muted">(${escapeHtml(p.uf)})</span>` : ''}<div class="muted">${escapeHtml(p.email)}</div>${p.contact_consent ? '' : '<div class="muted">sem autorização de contato</div>'}</td>
          <td class="text-sm">${escapeHtml(p.first_source || '—')}</td>
          <td class="tabular text-sm">${p.downloads}${p.requests > 1 ? ` <span class="muted">(${p.requests} pedidos)</span>` : ''}</td>
          <td>${statusBadge(p)}</td></tr>`).join('')}</tbody></table></div>`;
      list.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => openPerson(Number(tr.dataset.id), load)));
      const ok = r.items.filter((p) => p.contact_consent);
      list.querySelector('#pp-copy-wa').addEventListener('click', () => copy(ok.map((p) => `${p.name}: ${p.phone_display}`).join('\n'), `${ok.length} celular(es) copiado(s).`));
      list.querySelector('#pp-copy-em').addEventListener('click', () => copy(ok.map((p) => p.email).join(', '), `${ok.length} e-mail(s) copiado(s).`));
    }
    let deb;
    el.querySelector('#pp-q').addEventListener('input', (e) => { clearTimeout(deb); deb = setTimeout(() => { state.q = e.target.value.trim(); load(); }, 250); });
    el.querySelector('#pp-status').addEventListener('change', (e) => { state.status = e.target.value; load(); });
    el.querySelector('#pp-consent').addEventListener('change', (e) => { state.consent = e.target.value; load(); });
    await load();
  }

  async function openPerson(id, onChanged) {
    let p;
    try { p = await api.get(`/api/admin/downloads/pessoas/${id}`); } catch (err) { showToast(err.message, 'error'); return; }
    const b = openModal(`
      <div class="modal-header"><h3>${escapeHtml(p.name)}</h3><button class="modal-close" type="button" aria-label="Fechar" id="pp-close">×</button></div>
      <p>${consentBadge(p)} ${p.lead_id ? `<a class="badge badge-neutral" href="#/interessados/${p.lead_id}">ver nos Interessados</a>` : ''}</p>
      <dl class="store-kv">
        <dt>Celular</dt><dd>${escapeHtml(p.phone_display)}${p.uf ? ` (${escapeHtml(p.uf)})` : ''}</dd>
        <dt>E-mail</dt><dd><a href="mailto:${escapeHtml(p.email)}">${escapeHtml(p.email)}</a></dd>
        <dt>Cadastro</dt><dd>${escapeHtml(formatDateTime(p.created_at))} · origem: ${escapeHtml(p.first_source || '—')}</dd>
        <dt>Pedidos / downloads</dt><dd>${p.requests} pedido(s) · ${p.downloads} download(s) do arquivo</dd>
      </dl>
      ${p.contact_consent ? '' : '<div class="alert alert-info"><div>Esta pessoa <strong>não autorizou</strong> contato de divulgação da OLIMAIS. Só fale com ela se ela procurar vocês primeiro.</div></div>'}
      <div class="field-row">
        <div class="field"><label for="pp-st">Situação</label><select id="pp-st">${STATUS.map(([k, l]) => `<option value="${k}" ${k === p.status ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label for="pp-notes">Observações (só a equipe vê)</label><textarea id="pp-notes" rows="3" maxlength="2000">${escapeHtml(p.notes)}</textarea></div>
      <div class="form-actions" style="margin-top:0;"><button type="button" class="btn btn-primary btn-sm" id="pp-save">Salvar</button></div>
      <div class="store-actions">
        <a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="${escapeHtml(waLink(p))}">Abrir conversa no WhatsApp</a>
        <button type="button" class="btn btn-outline btn-sm" id="pp-copy">Copiar contato</button>
        ${p.lead_id ? '' : '<button type="button" class="btn btn-outline btn-sm" id="pp-lead">Adicionar aos Interessados</button>'}
        <button type="button" class="btn btn-danger btn-sm" id="pp-del">Apagar dados desta pessoa</button>
      </div>
      ${p.history.length ? `<h4 style="margin:18px 0 6px;">Histórico</h4><div class="table-wrap"><table><tbody>${p.history.map((h) => `<tr>
        <td class="text-sm">${escapeHtml(formatDateTime(h.created_at))}</td><td class="text-sm">${escapeHtml(h.material)} · origem ${escapeHtml(h.source || '—')}</td>
        <td class="text-sm tabular">${h.download_count}/${h.max_downloads} download(s)</td>
        <td class="text-sm">${h.email_sent_at ? 'e-mail enviado' : (h.email_error ? 'e-mail não enviado' : '')}</td></tr>`).join('')}</tbody></table></div>` : ''}`, { wide: true });
    b.querySelector('#pp-close').addEventListener('click', closeModal);
    const reopen = () => { closeModal(); if (onChanged) onChanged(); openPerson(id, onChanged); };
    b.querySelector('#pp-save').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { await api.put(`/api/admin/downloads/pessoas/${id}`, { status: b.querySelector('#pp-st').value, notes: b.querySelector('#pp-notes').value }); showToast('Salvo.'); reopen(); }
      catch (err) { showToast(err.message, 'error'); e.target.disabled = false; }
    });
    b.querySelector('#pp-copy').addEventListener('click', () => copy(`${p.name}\n${p.phone_display}\n${p.email}`, 'Contato copiado.'));
    const lead = b.querySelector('#pp-lead');
    if (lead) lead.addEventListener('click', async () => {
      if (!p.contact_consent && !(await confirmModal('Esta pessoa não autorizou contato de divulgação. Adicionar aos Interessados mesmo assim?', 'Adicionar'))) return reopen();
      lead.disabled = true;
      try { await api.post(`/api/admin/downloads/pessoas/${id}/interessado`); showToast('Adicionada aos Interessados (origem: Site).'); reopen(); }
      catch (err) { showToast(err.message, 'error'); lead.disabled = false; }
    });
    b.querySelector('#pp-del').addEventListener('click', async () => {
      if (!(await confirmModal(`Apagar de vez os dados de ${p.name} (cadastro e histórico de downloads)? Use isto, por exemplo, quando a pessoa pedir a exclusão. Não dá para desfazer.${p.lead_id ? ' O cadastro nos Interessados não é apagado: remova lá também, se for o caso.' : ''}`, 'Apagar'))) return reopen();
      try { await api.delete(`/api/admin/downloads/pessoas/${id}`); closeModal(); showToast('Dados apagados.'); if (onChanged) onChanged(); }
      catch (err) { showToast(err.message, 'error'); }
    });
  }

  // ---------- Material ----------

  async function renderMaterial(el) {
    const s = await api.get('/api/admin/downloads/resumo');
    const m = s.materials[0];
    if (!m) { el.innerHTML = '<div class="empty-state">Nenhum material cadastrado.</div>'; return; }
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h2>${escapeHtml(m.name)}</h2>${m.active ? '<span class="badge badge-confirmed">Downloads liberados</span>' : '<span class="badge badge-neutral">Downloads pausados</span>'}</div>
        <dl class="store-kv">
          <dt>PDF</dt><dd>${m.has_file ? `${escapeHtml(m.file_name)} · ${escapeHtml(formatBytes(m.file_size))} · <a href="/api/admin/downloads/materiais/${m.id}/arquivo" target="_blank" rel="noopener">abrir</a>` : '<span style="color:var(--danger)">ainda não enviado</span>'}</dd>
          <dt>Link de download</dt><dd>até ${m.max_downloads} downloads por cadastro, válido por ${m.link_days} dias</dd>
          <dt>Página no site</dt><dd><span class="store-code">${escapeHtml(m.site_url)}</span> <button type="button" class="btn-text" id="mt-copy">copiar</button></dd>
          <dt>E-mail com o link</dt><dd>${s.email_configured ? `ligado (remetente ${escapeHtml(s.email_from)})` : 'desligado (opcional): a pessoa baixa na hora, pela página. Para mandar também por e-mail, configure o Resend (veja o LEIA-ME).'}</dd>
        </dl>
        <div class="store-actions">
          <button type="button" class="btn btn-outline btn-sm" id="mt-file">${m.has_file ? 'Trocar o PDF' : 'Enviar o PDF'}</button>
          ${m.active ? '<button type="button" class="btn btn-outline btn-sm" id="mt-toggle" data-on="0">Pausar os downloads</button>'
            : `<button type="button" class="btn btn-primary btn-sm" id="mt-toggle" data-on="1" ${m.has_file ? '' : 'disabled title="Envie o PDF primeiro"'}>Liberar os downloads</button>`}
          <button type="button" class="btn btn-outline btn-sm" id="mt-edit">Ajustar limite e validade</button>
        </div>
        <input type="file" accept="application/pdf,.pdf" class="hidden" id="mt-input">
        <div class="mat-progress hidden" id="mt-prog"><i style="width:0%"></i></div>
        <p class="text-sm muted" style="margin-top:12px;">O texto e a capa da página ficam no site (arquivo manual-do-enem.html). Trocar o PDF aqui vale na hora para os próximos downloads.</p>
      </div>`;
    const reload = () => renderMaterial(el);
    el.querySelector('#mt-copy').addEventListener('click', () => copy(m.site_url, 'Endereço copiado.'));
    const toggle = el.querySelector('#mt-toggle');
    toggle.addEventListener('click', async () => {
      const on = toggle.dataset.on === '1';
      toggle.disabled = true;
      try { await api.put(`/api/admin/downloads/materiais/${m.id}`, { active: on }); showToast(on ? 'Downloads liberados.' : 'Downloads pausados.'); reload(); }
      catch (err) { showToast(err.message, 'error'); toggle.disabled = false; }
    });
    const input = el.querySelector('#mt-input');
    el.querySelector('#mt-file').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      if (!/\.pdf$/i.test(file.name)) { showToast('Escolha um arquivo PDF.', 'error'); return; }
      const prog = el.querySelector('#mt-prog');
      prog.classList.remove('hidden');
      try {
        await api.upload(`/api/admin/downloads/materiais/${m.id}/arquivo`, file, {
          headers: { 'X-File-Name': encodeURIComponent(file.name) },
          onProgress: (l, t) => { prog.firstElementChild.style.width = `${Math.floor((l / t) * 100)}%`; },
        });
        showToast('PDF enviado.');
        reload();
      } catch (err) { showToast(err.message, 'error'); prog.classList.add('hidden'); }
    });
    el.querySelector('#mt-edit').addEventListener('click', () => {
      const b = openModal(`
        <div class="modal-header"><h3>Limite e validade do link</h3></div>
        <div class="field-row">
          <div class="field"><label for="mt-max">Downloads por cadastro</label><input type="number" id="mt-max" min="1" max="20" value="${m.max_downloads}"></div>
          <div class="field"><label for="mt-days">Validade do link (dias)</label><input type="number" id="mt-days" min="1" max="90" value="${m.link_days}"></div>
        </div>
        <p class="text-sm muted">Vale para os próximos cadastros. Quem perder o link é só preencher o formulário de novo.</p>
        <div id="mt-err" class="alert alert-danger hidden"></div>
        <div class="form-actions"><button type="button" class="btn btn-outline" id="mt-cancel">Cancelar</button><button type="button" class="btn btn-primary" id="mt-ok">Salvar</button></div>`);
      b.querySelector('#mt-cancel').addEventListener('click', closeModal);
      b.querySelector('#mt-ok').addEventListener('click', async () => {
        try {
          await api.put(`/api/admin/downloads/materiais/${m.id}`, { max_downloads: Number(b.querySelector('#mt-max').value), link_days: Number(b.querySelector('#mt-days').value) });
          closeModal(); showToast('Salvo.'); reload();
        } catch (err) { const e = b.querySelector('#mt-err'); e.textContent = err.message; e.classList.remove('hidden'); }
      });
    });
  }
})();
