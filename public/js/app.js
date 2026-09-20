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

  try {
    const me = await api.get('/api/auth/me');
    if (!me.user) { window.location.href = '/login.html'; return; }
    if (me.user.type === 'teacher') { window.location.href = '/professor.html'; return; }
    document.getElementById('admin-name').textContent = me.user.name || me.user.email;
  } catch (e) {
    window.location.href = '/login.html';
    return;
  }

  router();
});
