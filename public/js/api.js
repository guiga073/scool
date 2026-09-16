// public/js/api.js
// Wrapper de fetch para a API + utilitários compartilhados por todas as páginas.

const api = {
  async request(method, path, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* resposta sem corpo JSON */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Erro (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body === undefined ? {} : body); },
  put(path, body) { return this.request('PUT', path, body === undefined ? {} : body); },
  delete(path) { return this.request('DELETE', path); },
};

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatCurrency(value) {
  const n = Number(value) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Converte 'YYYY-MM-DD HH:MM:SS' (formato do banco, hora local sem fuso) em Date local.
function parseDbDate(s) {
  if (!s) return null;
  return new Date(s.replace(' ', 'T'));
}

function pad2(n) { return String(n).padStart(2, '0'); }

// Converte Date local em 'YYYY-MM-DD HH:MM:SS' para enviar à API.
function toDbDateTime(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:00`;
}

function formatDate(s) {
  const d = parseDbDate(s);
  if (!d) return '—';
  return d.toLocaleDateString('pt-BR');
}

function formatTime(s) {
  const d = parseDbDate(s);
  if (!d) return '—';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(s) {
  const d = parseDbDate(s);
  if (!d) return '—';
  return `${formatDate(s)} às ${formatTime(s)}`;
}

const WEEKDAY_NAMES = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// ---------- Toast (mensagens rápidas) ----------

let toastTimer = null;
function showToast(message, kind) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:200;padding:12px 20px;border-radius:10px;font-size:13.5px;font-weight:600;box-shadow:0 8px 30px rgba(0,0,0,0.2);max-width:90vw;text-align:center;';
    document.body.appendChild(el);
  }
  el.style.background = kind === 'error' ? '#B84C3E' : '#1F4A42';
  el.style.color = '#fff';
  el.textContent = message;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3200);
}

// ---------- Modal genérico ----------

function openModal(innerHtml, opts) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'active-modal';
  backdrop.innerHTML = `<div class="modal ${opts && opts.wide ? 'modal-wide' : ''}">${innerHtml}</div>`;
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeModal(); });
  document.body.appendChild(backdrop);
  document.addEventListener('keydown', escCloseHandler);
  return backdrop;
}

function escCloseHandler(e) { if (e.key === 'Escape') closeModal(); }

function closeModal() {
  const el = document.getElementById('active-modal');
  if (el) el.remove();
  document.removeEventListener('keydown', escCloseHandler);
}

// Modal de confirmação simples (substitui confirm() nativo por algo consistente com o design)
function confirmModal(message, confirmLabel) {
  return new Promise((resolve) => {
    const backdrop = openModal(`
      <div class="modal-header"><h3>Confirmar ação</h3></div>
      <p>${escapeHtml(message)}</p>
      <div class="form-actions">
        <button class="btn btn-outline" id="confirm-cancel">Cancelar</button>
        <button class="btn btn-danger" id="confirm-ok" style="background:var(--danger);color:#fff;">${escapeHtml(confirmLabel || 'Confirmar')}</button>
      </div>
    `);
    backdrop.querySelector('#confirm-cancel').onclick = () => { closeModal(); resolve(false); };
    backdrop.querySelector('#confirm-ok').onclick = () => { closeModal(); resolve(true); };
  });
}
