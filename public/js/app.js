// public/js/app.js
// Inicialização do app: checa login, liga o menu mobile e roda o roteador por hash.

const Pages = window.Pages || {};

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  return { page: parts[0] || 'dashboard', id: parts[1] || null };
}

function setActiveNav(page) {
  document.querySelectorAll('.nav-item').forEach(li => {
    li.classList.toggle('active', li.dataset.page === page);
  });
}

async function router() {
  const { page, id } = parseHash();
  setActiveNav(page);
  const root = document.getElementById('page-root');
  root.innerHTML = '<div class="loading-dots">Carregando…</div>';
  closeSidebarMobile();

  try {
    if (page === 'dashboard') await Pages.dashboard(root);
    else if (page === 'alunos' && !id) await Pages.studentsList(root);
    else if (page === 'alunos' && id) await Pages.studentDetail(root, id);
    else if (page === 'professores' && !id) await Pages.teachersList(root);
    else if (page === 'professores' && id) await Pages.teacherDetail(root, id);
    else if (page === 'feedbacks') await Pages.feedbacks(root);
    else if (page === 'agendamento') await Pages.scheduling(root);
    else if (page === 'pagamentos') await Pages.payments(root);
    else root.innerHTML = '<div class="empty-state"><div class="eyebrow">404</div>Página não encontrada.</div>';
  } catch (err) {
    if (err.status === 401) { window.location.href = '/login.html'; return; }
    console.error(err);
    root.innerHTML = `<div class="alert alert-danger">Não foi possível carregar esta página: ${escapeHtml(err.message)}</div>`;
  }
}

function closeSidebarMobile() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('scrim').classList.remove('open');
}

window.addEventListener('hashchange', router);

window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('hamburger').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('scrim').classList.add('open');
  });
  document.getElementById('scrim').addEventListener('click', closeSidebarMobile);

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api.post('/api/auth/logout');
    window.location.href = '/login.html';
  });

  document.getElementById('recalc-btn').addEventListener('click', async () => {
    const ok = await confirmModal(
      'Isso vai substituir o "valor pago ao professor" e o "transporte" em TODAS as aulas já agendadas, usando o valor/hora e o transporte cadastrados hoje em cada professor (conforme a modalidade de cada aula). ' +
      'Aulas de professores sem valor/hora cadastrado para aquela modalidade não serão alteradas. Faturas já marcadas como pagas continuam protegidas e não mudam. Quer continuar?',
      'Recalcular valores'
    );
    if (!ok) return;
    try {
      const result = await api.post('/api/admin/recalculate-historical-values');
      let msg = `${result.updated} de ${result.totalClasses} aula(s) atualizada(s).`;
      if (result.skipped > 0) msg += ` ${result.skipped} não puderam ser recalculadas (sem valor/hora cadastrado): ${result.skippedTeachers.join(', ')}.`;
      openModal(`
        <div class="modal-header"><h3>Recálculo concluído</h3><button class="modal-close" id="recalc-done-close">&times;</button></div>
        <p>${escapeHtml(msg)}</p>
        <div class="form-actions"><button type="button" class="btn btn-primary" id="recalc-done-ok">Entendi</button></div>
      `);
      document.getElementById('recalc-done-close').onclick = closeModal;
      document.getElementById('recalc-done-ok').onclick = closeModal;
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  try {
    const me = await api.get('/api/auth/me');
    if (!me.user) { window.location.href = '/login.html'; return; }
    if (me.user.type === 'teacher') { window.location.href = '/professor.html'; return; }
    if (me.user.type === 'student') { window.location.href = '/aluno.html'; return; }
    document.getElementById('admin-name').textContent = me.user.name || me.user.email;
  } catch (e) {
    window.location.href = '/login.html';
    return;
  }

  router();
});
