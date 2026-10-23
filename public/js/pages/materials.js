// public/js/pages/materials.js
// Página "Materiais" da secretaria: quanto espaço está sendo usado, a chave que liga/desliga o
// envio pelos alunos e a lista de todos os materiais (com busca, ordem e como apagar).

window.Pages = window.Pages || {};

Pages.materials = async function (root) {
  const PAGE = 50;
  const plural = MaterialsPanel.plural;
  let q = '';
  let sort = 'recent';
  let items = [];
  let total = 0;

  root.innerHTML = `
    <div class="page-header">
      <div><div class="eyebrow">Biblioteca</div><h1>Materiais</h1>
        <p class="subtitle">Arquivos e links que professores e alunos compartilham nas aulas. Aqui você acompanha o espaço usado, escolhe se os alunos podem enviar e apaga o que não for mais necessário.</p></div>
    </div>
    <div id="mat-usage"></div>
    <div class="card">
      <div class="card-header"><h2>Quem pode enviar</h2></div>
      <div class="checkbox-row">
        <input type="checkbox" id="mat-student-uploads">
        <label for="mat-student-uploads">Permitir que os alunos enviem materiais</label>
      </div>
      <div class="field"><div class="hint">Os professores sempre podem enviar para os próprios alunos. Se você desmarcar, os alunos continuam vendo e baixando o que receberam, mas deixam de enviar arquivos e links.</div></div>
    </div>
    <div class="card">
      <div class="card-header"><h2>Todos os materiais</h2><span class="search-count" id="mat-count"></span></div>
      <div class="search-bar">
        <div class="search-field"><input type="text" class="search-input" id="mat-search" placeholder="Buscar…" aria-label="Buscar materiais por título, arquivo, aluno ou professor" autocomplete="off"></div>
        <select class="fin-select" id="mat-sort" aria-label="Ordenar materiais">
          <option value="recent">Mais recentes primeiro</option>
          <option value="size">Maiores primeiro</option>
        </select>
      </div>
      <p class="text-sm muted mat-search-hint">A busca procura no título, no nome do arquivo, no aluno e no professor.</p>
      <div id="mat-list"><div class="loading-dots">Carregando…</div></div>
      <div class="mat-more"><button type="button" class="btn btn-outline hidden" id="mat-more">Carregar mais</button></div>
    </div>
  `;

  const usageEl = root.querySelector('#mat-usage');
  const listEl = root.querySelector('#mat-list');
  const moreBtn = root.querySelector('#mat-more');
  const countEl = root.querySelector('#mat-count');
  const switchEl = root.querySelector('#mat-student-uploads');

  function renderUsage(u) {
    // Limite real (o menor entre o teto configurado e o que o disco do servidor permite).
    const limit = u.limitBytes !== undefined ? u.limitBytes : u.capBytes;
    const pct = u.remainingBytes <= 0 ? 100 : (limit ? (u.usedBytes / limit) * 100 : 0);
    const shown = pct > 0 && pct < 1 ? '< 1' : String(Math.round(pct));
    const level = pct >= 95 ? 'crit' : pct >= 80 ? 'warn' : '';
    const diskLow = u.diskFreeBytes !== null && u.diskFreeBytes < 300 * 1000 * 1000;
    let alerts = '';
    if (pct >= 95) {
      alerts += `<div class="alert alert-danger">O espaço de materiais está quase no fim: novos envios podem ser recusados. Apague materiais antigos ou aumente o espaço (veja “Materiais” no README).</div>`;
    } else if (pct >= 80) {
      alerts += `<div class="alert alert-warn">Atenção: o espaço de materiais já passou de 80%. Vale apagar o que não é mais usado — ou planejar mais espaço (veja “Materiais” no README).</div>`;
    }
    if (diskLow) {
      alerts += `<div class="alert alert-danger">O disco do servidor está com pouco espaço livre (${escapeHtml(formatBytes(u.diskFreeBytes))}). Por segurança, os envios são recusados quando restam menos de ${escapeHtml(formatBytes(u.minFreeBytes || 0))}, para o resto do portal continuar funcionando. Para resolver, aumente o volume na Railway (veja “Materiais” no README).</div>`;
    }
    usageEl.innerHTML = `
      <div class="card">
        <div class="card-header"><h2>Espaço usado</h2></div>
        <div class="mat-usage-numbers"><strong class="tabular">${escapeHtml(formatBytes(u.usedBytes))}</strong> de ${escapeHtml(formatBytes(limit))} <span class="muted">(${shown}%)</span></div>
        <div class="mat-usage-bar ${level}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-label="Espaço de materiais usado"><i style="width:${Math.min(100, pct).toFixed(1)}%"></i></div>
        <p class="text-sm muted" style="margin:0 0 12px;">${plural(u.fileCount, 'arquivo', 'arquivos')} · ${plural(u.linkCount, 'link', 'links')} · cada arquivo pode ter até ${escapeHtml(formatBytes(u.maxFileBytes))}.${u.limitedByDisk ? ` <strong>O limite de agora é o disco do servidor</strong>, que é menor que o teto configurado de ${escapeHtml(formatBytes(u.capBytes))} (já descontada a reserva de ${escapeHtml(formatBytes(u.minFreeBytes || 0))} para o banco de dados).` : ''}${u.diskTotalBytes ? ` Espaço livre no disco do servidor: ${escapeHtml(formatBytes(u.diskFreeBytes))} de ${escapeHtml(formatBytes(u.diskTotalBytes))}.` : ''}</p>
        ${alerts}
        <div class="alert alert-info"><div><strong>Backup:</strong> o link “Baixar backup dos dados” (no menu) salva só o banco de dados — cadastros, aulas, pagamentos e a lista de materiais. Os <strong>arquivos</strong> dos materiais não entram nele: ficam só no servidor. As opções para protegê-los estão na seção “Materiais” do README.</div></div>
      </div>`;
    switchEl.checked = !!u.studentUploads;
  }

  async function load(append) {
    const offset = append ? items.length : 0;
    const params = `q=${encodeURIComponent(q)}&sort=${sort}&limit=${PAGE}&offset=${offset}`;
    if (!append) listEl.innerHTML = '<div class="loading-dots">Carregando…</div>';
    const data = await api.get(`/api/admin/materials?${params}`);
    items = append ? items.concat(data.items) : data.items;
    total = data.total;
    renderUsage(data.usage);
    renderItems();
  }

  function renderItems() {
    countEl.textContent = total > 0
      ? (q ? plural(total, 'material encontrado', 'materiais encontrados') : plural(total, 'material', 'materiais'))
      : '';
    MaterialsPanel.renderItems(listEl, items, {
      viewer: 'admin',
      showPeople: true,
      groupByTeacher: false,
      emptyHtml: q
        ? '<div class="eyebrow">Nada encontrado</div>Nenhum material combina com essa busca.'
        : '<div class="eyebrow">Nada por aqui ainda</div>Quando professores e alunos enviarem materiais, eles aparecem aqui.',
      onChanged: () => load(false),
    });
    moreBtn.classList.toggle('hidden', items.length >= total);
  }

  let debounce;
  root.querySelector('#mat-search').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { q = e.target.value.trim(); load(false).catch(showLoadError); }, 250);
  });
  root.querySelector('#mat-sort').addEventListener('change', (e) => { sort = e.target.value; load(false).catch(showLoadError); });
  moreBtn.addEventListener('click', async () => {
    moreBtn.disabled = true;
    try { await load(true); } catch (err) { showLoadError(err); } finally { moreBtn.disabled = false; }
  });
  switchEl.addEventListener('change', async () => {
    const wanted = switchEl.checked;
    switchEl.disabled = true;
    try {
      await api.put('/api/admin/materials/settings', { studentUploads: wanted });
      showToast(wanted ? 'Alunos podem enviar materiais.' : 'Envio de materiais pelos alunos desligado.');
    } catch (err) {
      switchEl.checked = !wanted;
      showToast(err.message, 'error');
    } finally {
      switchEl.disabled = false;
    }
  });

  function showLoadError(err) {
    if (err && err.status === 401) { window.location.href = '/login.html'; return; }
    listEl.innerHTML = `<div class="alert alert-danger">Não foi possível carregar os materiais: ${escapeHtml(err.message)}</div>`;
  }

  try { await load(false); } catch (err) { showLoadError(err); }
};
