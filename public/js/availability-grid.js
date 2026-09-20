// public/js/availability-grid.js
// Grade de disponibilidade: Segunda a Domingo, das 8h às 20h, em blocos de 1 hora.
// Armazenada como { "1": [8,9,10], "2": [...], ... } onde a chave é o dia da semana
// no padrão de Date.getDay() (0 = domingo … 6 = sábado), mas exibida começando na
// segunda-feira, como as pessoas normalmente pensam numa semana de aulas.

const AVAIL_DAYS = [
  { key: 1, label: 'Segunda' },
  { key: 2, label: 'Terça' },
  { key: 3, label: 'Quarta' },
  { key: 4, label: 'Quinta' },
  { key: 5, label: 'Sexta' },
  { key: 6, label: 'Sábado' },
  { key: 0, label: 'Domingo' },
];
const AVAIL_HOURS = Array.from({ length: 12 }, (_, i) => i + 8); // 8..19 (bloco 8h–9h … 19h–20h)

const AvailabilityGrid = {
  // container: elemento DOM. grid: objeto { "1": [8,9,...], ... }.
  // opts: { editable = true, onChange(grid) }
  render(container, grid, opts) {
    opts = opts || {};
    const editable = opts.editable !== false;
    const state = {};
    for (const d of AVAIL_DAYS) state[d.key] = new Set((grid && grid[d.key]) || []);

    function isOn(day, hour) { return state[day].has(hour); }
    function toggle(day, hour) {
      if (state[day].has(hour)) state[day].delete(hour); else state[day].add(hour);
      redraw();
      emit();
    }
    function toggleDay(day) {
      const allOn = AVAIL_HOURS.every(h => state[day].has(h));
      if (allOn) state[day].clear(); else AVAIL_HOURS.forEach(h => state[day].add(h));
      redraw();
      emit();
    }
    function toggleHour(hour) {
      const allOn = AVAIL_DAYS.every(d => state[d.key].has(hour));
      AVAIL_DAYS.forEach(d => { if (allOn) state[d.key].delete(hour); else state[d.key].add(hour); });
      redraw();
      emit();
    }
    function emit() {
      if (opts.onChange) {
        const out = {};
        for (const d of AVAIL_DAYS) out[d.key] = Array.from(state[d.key]).sort((a, b) => a - b);
        opts.onChange(out);
      }
    }

    function redraw() {
      const table = container.querySelector('table');
      table.querySelectorAll('td[data-day][data-hour]').forEach(td => {
        const on = isOn(Number(td.dataset.day), Number(td.dataset.hour));
        td.classList.toggle('avail-on', on);
      });
    }

    container.innerHTML = `
      <div class="avail-grid-wrap">
        <table class="avail-grid">
          <thead><tr><th></th>${AVAIL_DAYS.map(d => `<th ${editable ? 'class="avail-clickable"' : ''} data-day-header="${d.key}">${d.label.slice(0, 3)}</th>`).join('')}</tr></thead>
          <tbody>
            ${AVAIL_HOURS.map(h => `
              <tr>
                <th ${editable ? 'class="avail-clickable"' : ''} data-hour-header="${h}">${h}h</th>
                ${AVAIL_DAYS.map(d => `<td data-day="${d.key}" data-hour="${h}" class="${isOn(d.key, h) ? 'avail-on' : ''}"></td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${editable ? '<div class="hint">Toque numa hora para marcar/desmarcar. Toque no nome do dia ou na hora, na borda, pra marcar a linha ou coluna toda.</div>' : ''}
    `;

    if (editable) {
      container.querySelectorAll('td[data-day][data-hour]').forEach(td => {
        td.addEventListener('click', () => toggle(Number(td.dataset.day), Number(td.dataset.hour)));
      });
      container.querySelectorAll('[data-day-header]').forEach(th => {
        th.addEventListener('click', () => toggleDay(Number(th.dataset.dayHeader)));
      });
      container.querySelectorAll('[data-hour-header]').forEach(th => {
        th.addEventListener('click', () => toggleHour(Number(th.dataset.hourHeader)));
      });
    }

    return {
      getValue() {
        const out = {};
        for (const d of AVAIL_DAYS) out[d.key] = Array.from(state[d.key]).sort((a, b) => a - b);
        return out;
      },
    };
  },
};
