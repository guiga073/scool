// public/js/aluno-app.js

let currentStudent = null;

async function initAlunoApp() {
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api.post('/api/auth/logout');
    window.location.href = '/login.html';
  });

  let me;
  try {
    const meResp = await api.get('/api/auth/me');
    if (!meResp.user) { window.location.href = '/login.html'; return; }
    if (meResp.user.type === 'admin') { window.location.href = '/'; return; }
    if (meResp.user.type === 'teacher') { window.location.href = '/professor.html'; return; }
    me = meResp.user;
  } catch (e) {
    window.location.href = '/login.html';
    return;
  }

  currentStudent = await api.get('/api/student-portal/me');
  renderShell();
}

function renderShell() {
  const root = document.getElementById('page-root');
  root.innerHTML = `
    <div class="page-header">
      <div><div class="eyebrow">Bem-vindo(a)</div><h1>${escapeHtml(currentStudent.name)}</h1></div>
    </div>
    <div class="tabs">
      <button class="tab-btn active" data-tab="aulas">Minhas aulas</button>
      <button class="tab-btn" data-tab="feedbacks">Feedbacks</button>
    </div>
    <div id="tab-content"></div>
  `;
  let activeTab = 'aulas';
  root.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      renderTab();
    });
  });
  function renderTab() {
    const el = document.getElementById('tab-content');
    if (activeTab === 'aulas') renderAulas(el);
    else if (activeTab === 'feedbacks') renderFeedbacks(el);
  }
  renderTab();
}

async function renderAulas(el) {
  el.innerHTML = `<div class="card"><div id="aluno-cal"></div></div>`;
  Calendar.mount(document.getElementById('aluno-cal'), { view: 'week', refDate: new Date() }, {
    fetchClasses: async (start, end) => api.get(`/api/student-portal/classes?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
    onSelectClass: (cls) => {
      const backdrop = openModal(`
        <div class="modal-header"><h3>${escapeHtml(cls.subject_name)}</h3><button class="modal-close" id="ac-close">&times;</button></div>
        <p class="muted text-sm">${formatDate(cls.start_time)} · ${formatTime(cls.start_time)}–${formatTime(cls.end_time)}</p>
        <div class="field-row" style="margin-top:14px;">
          <div><div class="text-sm muted">Professor</div><p>${escapeHtml(cls.teacher_name)}</p></div>
          <div><div class="text-sm muted">Modalidade</div><p>${cls.modality === 'online' ? 'Online' : 'Presencial'}</p></div>
        </div>
        ${cls.modality === 'online' ? `<div><div class="text-sm muted">Link</div><p>${meetingLinkHtml(cls.meeting_link)}</p></div>` : ''}
      `);
      document.getElementById('ac-close').onclick = closeModal;
    },
    // Sem onCreateAt: o aluno só visualiza a própria agenda, quem agenda é a secretaria.
  });
}

async function renderFeedbacks(el) {
  el.innerHTML = `<div class="card"><div class="loading-dots">Carregando…</div></div>`;
  const entries = await api.get('/api/student-portal/feedback');
  el.innerHTML = `
    <div class="card">
      <div class="card-header"><h2>Feedback dos professores</h2></div>
      <div id="aluno-feedback-list"></div>
    </div>
  `;
  const listEl = document.getElementById('aluno-feedback-list');
  if (entries.length === 0) {
    listEl.innerHTML = `<div class="empty-state">Nenhum feedback registrado ainda.</div>`;
    return;
  }
  listEl.innerHTML = entries.map(f => {
    const [y, m, d] = String(f.date).split('-');
    return `
      <div class="card" style="margin-bottom:10px; padding:14px 16px;">
        <span class="text-sm" style="font-weight:700; color:var(--ink-soft);">${d}/${m}/${y} · ${escapeHtml(f.teacher_name)}</span>
        <p style="margin:6px 0 0 0; white-space:pre-wrap;">${escapeHtml(f.feedback)}</p>
      </div>
    `;
  }).join('');
}

window.addEventListener('DOMContentLoaded', initAlunoApp);
