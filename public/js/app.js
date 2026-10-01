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
    else if (page === 'financeiro') await Pages.finance(root);
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

function openAccountModal(currentEmail) {
  const backdrop = openModal(`
    <div class="modal-header"><h3>Minha conta</h3><button class="modal-close" id="acc-close">&times;</button></div>
    <form id="account-form">
      <div class="field"><label for="acc-email">E-mail de login</label>
        <input type="email" id="acc-email" value="${escapeHtml(currentEmail || '')}" required></div>
      <div class="field"><label for="acc-new-password">Nova senha</label>
        <input type="password" id="acc-new-password" autocomplete="new-password">
        <div class="hint">Deixe em branco para manter a senha atual.</div></div>
      <div class="field hidden" id="acc-confirm-wrap"><label for="acc-confirm-password">Confirmar nova senha</label>
        <input type="password" id="acc-confirm-password" autocomplete="new-password"></div>
      <div class="field"><label for="acc-current-password">Senha atual</label>
        <input type="password" id="acc-current-password" required autocomplete="current-password">
        <div class="hint">Sempre pedida, por segurança, mesmo que você só esteja trocando o e-mail.</div></div>
      <div id="acc-error" class="alert alert-danger hidden"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" id="acc-cancel">Cancelar</button>
        <button type="submit" class="btn btn-primary">Salvar</button>
      </div>
    </form>
  `);
  backdrop.querySelector('#acc-close').onclick = closeModal;
  backdrop.querySelector('#acc-cancel').onclick = closeModal;

  const newPasswordInput = backdrop.querySelector('#acc-new-password');
  const confirmWrap = backdrop.querySelector('#acc-confirm-wrap');
  newPasswordInput.addEventListener('input', () => {
    confirmWrap.classList.toggle('hidden', !newPasswordInput.value);
  });

  backdrop.querySelector('#account-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = backdrop.querySelector('#acc-error');
    errEl.classList.add('hidden');
    const newPassword = newPasswordInput.value;
    const confirmPassword = backdrop.querySelector('#acc-confirm-password').value;
    if (newPassword && newPassword.length < 6) {
      errEl.textContent = 'Nova senha deve ter ao menos 6 caracteres.';
      errEl.classList.remove('hidden');
      return;
    }
    if (newPassword && newPassword !== confirmPassword) {
      errEl.textContent = 'A confirmação não bate com a nova senha.';
      errEl.classList.remove('hidden');
      return;
    }
    try {
      await api.put('/api/auth/account', {
        currentPassword: backdrop.querySelector('#acc-current-password').value,
        newEmail: backdrop.querySelector('#acc-email').value.trim(),
        newPassword: newPassword || undefined,
      });
      closeModal();
      showToast('Dados da conta atualizados.');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });
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

  document.getElementById('account-link').addEventListener('click', async (e) => {
    e.preventDefault();
    const me = await api.get('/api/auth/me');
    openAccountModal(me.user ? me.user.email : '');
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
