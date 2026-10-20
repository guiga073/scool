// public/js/pages/whatsapp.js
// Página "WhatsApp" (só a administração): situação da integração, ajustes, testes, modelos de mensagem
// para cadastrar na Meta e histórico recente. Os segredos (token etc.) NÃO aparecem aqui: ficam nas
// variáveis da Railway; a página só mostra se estão configurados.

(function () {
  window.Pages = window.Pages || {};

  const KIND_LABEL = {
    confirmacao: 'Aviso de confirmação', alerta_admin: 'Alerta à administração',
    resposta: 'Resposta automática', teste: 'Teste', recebida: 'Mensagem recebida',
  };
  const STATUS_LABEL = {
    enviada: 'Enviada', entregue: 'Entregue', lida: 'Lida', falhou: 'Falhou', recebida: 'Recebida',
    aplicada: 'Aplicada', ignorada: 'Ignorada', sem_acao: 'Sem ação', teste: 'Teste',
  };
  const STATUS_BADGE = {
    enviada: 'badge-neutral', entregue: 'badge-confirmed', lida: 'badge-confirmed', falhou: 'badge-danger',
    recebida: 'badge-neutral', aplicada: 'badge-confirmed', ignorada: 'badge-pending', sem_acao: 'badge-pending', teste: 'badge-neutral',
  };

  function checkItem(state, label, variable, hint) {
    const mark = state === 'ok' ? '✓' : (state === 'opt' ? '○' : '✗');
    return `<li class="wa-check ${state}"><span class="wa-mark" aria-hidden="true">${mark}</span>
      <span><strong>${escapeHtml(label)}</strong>${variable ? ` <code>${escapeHtml(variable)}</code>` : ''}
      <span class="sr-only">${state === 'ok' ? ' (configurado)' : (state === 'opt' ? ' (opcional, não configurado)' : ' (falta configurar)')}</span>
      ${hint ? `<div class="text-sm muted">${hint}</div>` : ''}</span></li>`;
  }

  function copyText(text, okMessage) {
    const done = () => showToast(okMessage || 'Copiado.');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => showToast('Não foi possível copiar. Selecione o texto e copie manualmente.', 'error'));
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { showToast('Não foi possível copiar. Selecione o texto e copie manualmente.', 'error'); }
    ta.remove();
  }

  function logTableHtml(rows) {
    if (rows.length === 0) return '<div class="empty-state">Nenhuma mensagem ainda. Os envios e as respostas aparecem aqui.</div>';
    return `<div class="table-wrap"><table class="wa-log">
      <thead><tr><th>Quando</th><th>O quê</th><th>Aluno</th><th>Telefone</th><th>Situação</th><th>Detalhe</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td style="white-space:nowrap;">${escapeHtml(formatDateTime(r.created_at))}</td>
          <td style="white-space:nowrap;">${r.direction === 'in' ? '↙' : '↗'} ${escapeHtml(KIND_LABEL[r.kind] || r.kind)}</td>
          <td>${r.student_name ? escapeHtml(r.student_name) : '—'}</td>
          <td style="white-space:nowrap;">${escapeHtml(r.phone || '—')}</td>
          <td><span class="badge ${STATUS_BADGE[r.status] || 'badge-neutral'}">${escapeHtml(STATUS_LABEL[r.status] || r.status || '—')}</span></td>
          <td class="wa-detail">${escapeHtml(r.detail || '')}</td>
        </tr>`).join('')}
      </tbody></table></div>`;
  }

  Pages.whatsapp = async function (root) {
    let st = await api.get('/api/whatsapp/status');
    let log = await api.get('/api/whatsapp/log');

    function render() {
      const s = st.settings;
      const e = st.env;
      root.innerHTML = `
        <div class="page-header">
          <div><div class="eyebrow">Integração</div><h1>WhatsApp</h1>
            <p class="subtitle">Confirmação automática das aulas pelo WhatsApp Business (API oficial da Meta). Só a administração vê esta página.</p></div>
        </div>

        <div class="card" id="wa-status-card">
          <div class="card-header"><h2>Situação da integração</h2>
            ${st.active ? '<span class="badge badge-confirmed" id="wa-active-badge">Ligada</span>' : '<span class="badge badge-neutral" id="wa-active-badge">Desligada</span>'}</div>
          <ul class="wa-checks">
            ${checkItem(e.token ? 'ok' : 'bad', 'Token de acesso', 'WHATSAPP_TOKEN', e.token ? '' : 'Falta criar na Meta e colocar nas variáveis da Railway (veja o guia).')}
            ${checkItem(e.phoneNumberId ? 'ok' : 'bad', 'ID do número de telefone', 'WHATSAPP_PHONE_NUMBER_ID', e.phoneNumberIdInvalid ? 'O valor configurado não é só números: copie de novo o “ID do número de telefone”.' : (e.phoneNumberId ? '' : 'Falta colocar nas variáveis da Railway.'))}
            ${checkItem(e.appSecret ? 'ok' : 'bad', 'Segredo do app', 'WHATSAPP_APP_SECRET', e.appSecret ? '' : 'Sem ele o sistema recusa as respostas que chegam da Meta (os botões Sim/Não não funcionam).')}
            ${checkItem(e.verifyToken ? 'ok' : 'bad', 'Token de verificação do webhook', 'WHATSAPP_VERIFY_TOKEN', e.verifyToken ? '' : 'Uma senha longa inventada por você; a mesma vai na Railway e no cadastro do webhook na Meta.')}
            ${checkItem(e.wabaId ? 'ok' : 'opt', 'ID da conta do WhatsApp Business', 'WHATSAPP_WABA_ID', e.wabaId ? '' : 'Opcional: com ele, “Testar conexão” mostra se os modelos de mensagem já foram aprovados.')}
            ${checkItem(st.lastWebhookAt ? 'ok' : 'bad', 'Webhook', '', st.lastWebhookAt ? `Última chamada recebida da Meta em ${escapeHtml(formatDateTime(st.lastWebhookAt))}.` : 'Nenhuma chamada recebida da Meta ainda. Cadastre o endereço abaixo no webhook da Meta e envie um teste (veja o guia).')}
          </ul>
          <div class="field">
            <label for="wa-webhook-url">Endereço do webhook (para colar na Meta)</label>
            <div class="flex gap-10 wrap">
              <input type="text" id="wa-webhook-url" value="${escapeHtml(st.webhookUrl)}" readonly style="flex:1 1 280px;">
              <button type="button" class="btn btn-outline btn-sm" id="wa-copy-url">Copiar</button>
            </div>
          </div>
          <div class="flex gap-10 wrap">
            <button type="button" class="btn btn-outline" id="wa-test-conn">Testar conexão com a Meta</button>
          </div>
          <div id="wa-conn-result" style="margin-top:12px;"></div>
        </div>

        ${st.sendProblems > 0 ? `
        <div class="alert alert-warn" id="wa-problems">
          <div><strong>${st.sendProblems} aula(s)</strong> com aviso de confirmação que não saiu. Veja os detalhes no histórico abaixo ou no Painel.
            Depois de consertar o problema (telefone, token, modelo...), libere os avisos para o sistema tentar de novo:
            <div style="margin-top:8px;"><button type="button" class="btn btn-outline btn-sm" id="wa-retry">Tentar de novo os avisos com erro</button></div></div>
        </div>` : ''}

        <div class="card" id="wa-settings-card">
          <div class="card-header"><h2>Ajustes</h2></div>
          <div class="field">
            <div class="checkbox-row"><input type="checkbox" id="wa-enabled" ${s.enabled ? 'checked' : ''}><label for="wa-enabled">Ligar a confirmação automática das aulas</label></div>
            <div class="hint">Ligada: ${st.rules.sendBeforeHours}h antes de cada aula o sistema pede a confirmação pelo WhatsApp e, sem resposta até ${st.rules.autoConfirmBeforeHours}h antes, confirma a aula sozinho. Desligada: nada é enviado nem confirmado automaticamente (as respostas que chegarem continuam sendo registradas). Ao ligar, as aulas que já estiverem a menos de ${st.rules.sendBeforeHours}h recebem o aviso em até 1 minuto.
              ${st.credentialsReady ? '' : '<br><strong>Para ligar, configure antes o token e o ID do número na Railway.</strong>'}</div>
          </div>
          <div class="field">
            <label for="wa-admin-phone">Telefone da Olimais que recebe o alerta de pedido de cancelamento</label>
            <input type="tel" id="wa-admin-phone" value="${escapeHtml(s.adminPhone)}" placeholder="(21) 99999-1234">
            <div class="hint">Use o WhatsApp que a equipe acompanha, com DDD. Tem que ser um número <strong>diferente</strong> do número conectado à API (um número não envia mensagem para si mesmo).</div>
          </div>
          <div class="field">
            <div class="checkbox-row"><input type="checkbox" id="wa-ack" ${s.ack ? 'checked' : ''}><label for="wa-ack">Responder automaticamente quando alguém tocar em “Sim” ou “Não”</label></div>
            <div class="hint">Sim: “Obrigado! Aula confirmada”. Não: “Recebemos o seu pedido… nossa equipe vai entrar em contato”.</div>
          </div>
          <div class="field-row">
            <div class="field"><label for="wa-tpl-confirm-name">Nome do modelo de confirmação</label><input type="text" id="wa-tpl-confirm-name" value="${escapeHtml(s.templateConfirm)}" autocomplete="off" spellcheck="false"></div>
            <div class="field"><label for="wa-tpl-alert-name">Nome do modelo de alerta</label><input type="text" id="wa-tpl-alert-name" value="${escapeHtml(s.templateAlert)}" autocomplete="off" spellcheck="false"></div>
            <div class="field"><label for="wa-lang">Idioma dos modelos</label><input type="text" id="wa-lang" value="${escapeHtml(s.language)}" autocomplete="off" spellcheck="false"></div>
          </div>
          <div class="hint" style="margin-top:-6px;margin-bottom:12px;">Os nomes e o idioma precisam ser exatamente os que foram aprovados na Meta (letras minúsculas, números e _).</div>
          <div id="wa-settings-error" class="alert alert-danger hidden"></div>
          <div class="form-actions"><button type="button" class="btn btn-primary" id="wa-save">Salvar ajustes</button></div>
        </div>

        <div class="card" id="wa-test-card">
          <div class="card-header"><h2>Testes</h2></div>
          <p class="text-sm muted" style="margin-top:0;">Envia uma mensagem de teste (nenhuma aula é alterada) para conferir tudo antes de ligar. No teste do aviso, toque em “Sim” ou “Não” no celular: a resposta aparece no histórico abaixo — é a prova de que o webhook está funcionando.</p>
          <div class="field">
            <label for="wa-test-phone">Telefone que vai receber o teste</label>
            <input type="tel" id="wa-test-phone" placeholder="(21) 99999-1234">
            <div class="hint">Se estiver vazio, o teste de alerta vai para o telefone dos alertas (acima).</div>
          </div>
          <div class="flex gap-10 wrap">
            <button type="button" class="btn btn-outline" id="wa-test-confirm">Enviar teste do aviso de confirmação</button>
            <button type="button" class="btn btn-outline" id="wa-test-alert">Enviar teste do alerta à administração</button>
          </div>
        </div>

        <div class="card" id="wa-templates-card">
          <div class="card-header"><h2>Modelos de mensagem para cadastrar na Meta</h2></div>
          <p class="text-sm muted" style="margin-top:0;">Mensagens que a empresa começa só podem usar modelos aprovados pela Meta. Copie os textos abaixo (as variáveis <code>{{1}}</code>, <code>{{2}}</code>... são trocadas a cada envio). O passo a passo está no guia.</p>
          <details class="wa-details">
            <summary>Modelo 1 — pedido de confirmação (nome sugerido: <code>olimais_confirmacao_aula</code>)</summary>
            <p class="text-sm muted">Categoria: <strong>Utilidade</strong> (Utility) · Idioma: Português (BR) · Botões de resposta rápida: <strong>${st.templates.confirm.buttons.map(escapeHtml).join('</strong> e <strong>')}</strong></p>
            <textarea readonly rows="17" id="wa-tpl-confirm-text">${escapeHtml(st.templates.confirm.body)}</textarea>
            <p class="text-sm muted">Exemplos para a Meta: ${st.templates.confirm.examples.map((x, i) => `<code>{{${i + 1}}}</code> = ${escapeHtml(x)}`).join(' · ')}</p>
            <button type="button" class="btn btn-outline btn-sm" id="wa-copy-confirm">Copiar texto</button>
          </details>
          <details class="wa-details">
            <summary>Modelo 2 — alerta de pedido de cancelamento (nome sugerido: <code>olimais_alerta_cancelamento</code>)</summary>
            <p class="text-sm muted">Categoria: <strong>Utilidade</strong> (Utility) · Idioma: Português (BR) · Sem botões</p>
            <textarea readonly rows="9" id="wa-tpl-alert-text">${escapeHtml(st.templates.alert.body)}</textarea>
            <p class="text-sm muted">Exemplos para a Meta: ${st.templates.alert.examples.map((x, i) => `<code>{{${i + 1}}}</code> = ${escapeHtml(x)}`).join(' · ')}</p>
            <button type="button" class="btn btn-outline btn-sm" id="wa-copy-alert">Copiar texto</button>
          </details>
        </div>

        <div class="card" id="wa-log-card">
          <div class="card-header"><h2>Histórico recente</h2>
            <button type="button" class="btn btn-outline btn-sm" id="wa-refresh-log">Atualizar</button></div>
          <p class="text-sm muted" style="margin-top:0;">Mensagens enviadas e recebidas (ficam guardadas por 90 dias). “Sem ação” = alguém escreveu um texto que o sistema não entendeu como Sim/Não: nenhuma aula foi alterada, vale responder por outro canal.</p>
          <div id="wa-log-wrap">${logTableHtml(log)}</div>
        </div>
      `;
      bind();
    }

    async function refreshLog() {
      log = await api.get('/api/whatsapp/log');
      const wrap = document.getElementById('wa-log-wrap');
      if (wrap) wrap.innerHTML = logTableHtml(log);
    }

    function bind() {
      const $ = (id) => document.getElementById(id);
      $('wa-copy-url').addEventListener('click', () => copyText(st.webhookUrl, 'Endereço copiado.'));
      $('wa-copy-confirm').addEventListener('click', () => copyText(st.templates.confirm.body, 'Texto copiado.'));
      $('wa-copy-alert').addEventListener('click', () => copyText(st.templates.alert.body, 'Texto copiado.'));
      $('wa-refresh-log').addEventListener('click', async () => { await refreshLog(); showToast('Histórico atualizado.'); });

      $('wa-test-conn').addEventListener('click', async () => {
        const btn = $('wa-test-conn');
        const out = $('wa-conn-result');
        btn.disabled = true;
        out.innerHTML = '<div class="loading-dots">Consultando a Meta…</div>';
        try {
          const r = await api.post('/api/whatsapp/test-connection', {});
          if (!r.ok) { out.innerHTML = `<div class="alert alert-danger">${escapeHtml(r.error)}</div>`; return; }
          const p = r.phone;
          let tpl = '';
          if (r.templates) {
            tpl = '<ul class="wa-tpl-status">' + r.templates.map((t) => {
              if (t.found.length === 0) return `<li><code>${escapeHtml(t.name)}</code>: <span class="badge badge-danger">não encontrado na Meta</span></li>`;
              return `<li><code>${escapeHtml(t.name)}</code>: ${t.found.map((f) => `${escapeHtml(f.language)} <span class="badge ${f.status === 'APPROVED' ? 'badge-confirmed' : 'badge-pending'}">${escapeHtml(f.status)}</span>${f.category ? ' (' + escapeHtml(f.category) + ')' : ''}`).join(' · ')}</li>`;
            }).join('') + '</ul>';
          } else if (r.templatesError) {
            tpl = `<div class="text-sm muted">Não foi possível consultar os modelos: ${escapeHtml(r.templatesError)}</div>`;
          }
          out.innerHTML = `<div class="alert alert-info"><div><strong>Conectado.</strong> Número: ${escapeHtml(p.displayPhoneNumber || '—')}` +
            `${p.verifiedName ? ' · nome: ' + escapeHtml(p.verifiedName) : ''}${p.qualityRating ? ' · qualidade: ' + escapeHtml(p.qualityRating) : ''}${tpl}</div></div>`;
        } catch (err) {
          out.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
        } finally {
          btn.disabled = false;
        }
      });

      $('wa-save').addEventListener('click', async () => {
        const errEl = $('wa-settings-error');
        errEl.classList.add('hidden');
        try {
          st = await api.put('/api/whatsapp/settings', {
            enabled: $('wa-enabled').checked,
            ack: $('wa-ack').checked,
            admin_phone: $('wa-admin-phone').value.trim(),
            template_confirm: $('wa-tpl-confirm-name').value.trim(),
            template_alert: $('wa-tpl-alert-name').value.trim(),
            language: $('wa-lang').value.trim(),
          });
          showToast('Ajustes salvos.');
          render();
        } catch (err) {
          errEl.textContent = err.message;
          errEl.classList.remove('hidden');
        }
      });

      async function sendTest(kind) {
        const phone = $('wa-test-phone').value.trim();
        const btns = [$('wa-test-confirm'), $('wa-test-alert')];
        btns.forEach((b) => { b.disabled = true; });
        try {
          await api.post('/api/whatsapp/test-message', { kind, phone });
          showToast('Mensagem de teste enviada. Confira o celular.');
        } catch (err) {
          showToast(err.message, 'error');
        } finally {
          btns.forEach((b) => { b.disabled = false; });
          refreshLog();
        }
      }
      $('wa-test-confirm').addEventListener('click', () => sendTest('confirmacao'));
      $('wa-test-alert').addEventListener('click', () => sendTest('alerta'));

      const retry = $('wa-retry');
      if (retry) {
        retry.addEventListener('click', async () => {
          retry.disabled = true;
          try {
            const r = await api.post('/api/whatsapp/retry-failed', {});
            showToast(r.released > 0 ? `${r.released} aviso(s) liberado(s): o sistema tenta de novo em até 1 minuto.` : 'Nenhum aviso pôde ser liberado (só dá para aulas com mais de 5h pela frente).');
            st = await api.get('/api/whatsapp/status');
            await refreshLog();
            render();
          } catch (err) {
            showToast(err.message, 'error');
            retry.disabled = false;
          }
        });
      }
    }

    render();
  };
})();
