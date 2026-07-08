const state = {
  vessels: [],
  voyages: [],
};

const el = (id) => document.getElementById(id);

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function numberFmt(n, digits = 1) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: digits });
}

function showToast(message, isError = false) {
  const toast = el('toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, 3200);
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------- Routing ----------

const VIEWS = ['dashboard', 'voyages', 'vessels', 'voyage-detail'];

function setActiveNav(view) {
  document.querySelectorAll('.nav-link').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
}

function showView(name) {
  VIEWS.forEach((v) => { el(`view-${v}`).hidden = v !== name; });
}

async function router() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [route, param] = hash.split('/');

  if (route === 'voyages' && param) {
    setActiveNav('voyages');
    showView('voyage-detail');
    await renderVoyageDetail(param);
    return;
  }

  const view = ['dashboard', 'voyages', 'vessels'].includes(route) ? route : 'dashboard';
  setActiveNav(view);
  showView(view);
  el('view-title').textContent = {
    dashboard: 'Dashboard',
    voyages: 'Voyages',
    vessels: 'Vessels',
  }[view];

  if (view === 'dashboard') await renderDashboard();
  if (view === 'voyages') await renderVoyages();
  if (view === 'vessels') await renderVessels();
}

window.addEventListener('hashchange', router);
document.querySelectorAll('.nav-link').forEach((btn) => {
  btn.addEventListener('click', () => { window.location.hash = `/${btn.dataset.view}`; });
});

// ---------- Dashboard ----------

async function renderDashboard() {
  const container = el('view-dashboard');
  container.innerHTML = '<p class="text-muted">Loading...</p>';

  const voyages = await api('/voyages');
  state.voyages = voyages;

  const ongoing = voyages.filter((v) => v.status === 'ONGOING').length;
  const totalNetResult = voyages.reduce((sum, v) => sum + v.pnl.netVoyageResult, 0);
  const tceValues = voyages.filter((v) => v.pnl.voyageDays > 0).map((v) => v.pnl.tcePerDay);
  const avgTce = tceValues.length ? tceValues.reduce((a, b) => a + b, 0) / tceValues.length : 0;

  container.innerHTML = `
    <div class="kpi-row">
      <div class="kpi-tile">
        <div class="kpi-label">Total Voyages</div>
        <div class="kpi-value">${voyages.length}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Ongoing Voyages</div>
        <div class="kpi-value">${ongoing}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Total Net Result</div>
        <div class="kpi-value ${totalNetResult >= 0 ? 'positive' : 'negative'}">${money(totalNetResult)}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Average TCE / Day</div>
        <div class="kpi-value ${avgTce >= 0 ? 'positive' : 'negative'}">${money(avgTce)}</div>
      </div>
    </div>

    <div class="card">
      <div class="section-title">
        <h2>Recent Voyages</h2>
        <button class="btn" id="dash-new-voyage">+ New Voyage</button>
      </div>
      ${voyagesTable(voyages.slice(0, 8))}
    </div>
  `;

  el('dash-new-voyage')?.addEventListener('click', () => { window.location.hash = '/voyages'; });
  bindVoyageRowLinks(container);
}

function voyagesTable(voyages) {
  if (!voyages.length) {
    return '<div class="empty-state">No voyages yet. Create your first voyage to see estimates here.</div>';
  }
  const rows = voyages.map((v) => `
    <tr>
      <td><button class="link-btn voyage-link" data-id="${v.id}">${v.reference || 'Voyage #' + v.id}</button></td>
      <td>${v.vessel_name}</td>
      <td>${v.charterer || '-'}</td>
      <td><span class="badge ${v.status.toLowerCase()}">${v.status}</span></td>
      <td class="mono">${numberFmt(v.pnl.voyageDays)}</td>
      <td class="mono ${v.pnl.netVoyageResult >= 0 ? 'positive' : 'negative'}">${money(v.pnl.netVoyageResult)}</td>
      <td class="mono ${v.pnl.tcePerDay >= 0 ? 'positive' : 'negative'}">${money(v.pnl.tcePerDay)}</td>
    </tr>
  `).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>Reference</th><th>Vessel</th><th>Charterer</th><th>Status</th>
          <th>Voyage Days</th><th>Net Result</th><th>TCE / Day</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function bindVoyageRowLinks(container) {
  container.querySelectorAll('.voyage-link').forEach((btn) => {
    btn.addEventListener('click', () => { window.location.hash = `/voyages/${btn.dataset.id}`; });
  });
}

// ---------- Voyages list + create ----------

async function renderVoyages() {
  const container = el('view-voyages');
  container.innerHTML = '<p class="text-muted">Loading...</p>';

  const [voyages, vessels] = await Promise.all([api('/voyages'), api('/vessels')]);
  state.voyages = voyages;
  state.vessels = vessels;

  container.innerHTML = `
    <div class="card">
      <div class="section-title"><h2>New Voyage Estimate</h2></div>
      ${vessels.length ? newVoyageForm(vessels) : '<div class="empty-state">Add a vessel first, then come back to create a voyage.</div>'}
    </div>
    <div class="card">
      <div class="section-title"><h2>All Voyages</h2></div>
      ${voyagesTable(voyages)}
    </div>
  `;

  bindVoyageRowLinks(container);

  const form = el('new-voyage-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      try {
        const voyage = await api('/voyages', {
          method: 'POST',
          body: JSON.stringify({
            vessel_id: Number(data.vessel_id),
            reference: data.reference,
            charterer: data.charterer,
            cargo_type: data.cargo_type,
            cargo_quantity_mt: Number(data.cargo_quantity_mt || 0),
            freight_type: data.freight_type,
            freight_rate: Number(data.freight_rate || 0),
            address_commission_pct: Number(data.address_commission_pct || 0),
            brokerage_pct: Number(data.brokerage_pct || 0),
            laycan_start: data.laycan_start || null,
            laycan_end: data.laycan_end || null,
            status: data.status,
            notes: data.notes,
          }),
        });
        showToast('Voyage created');
        window.location.hash = `/voyages/${voyage.voyage.id}`;
      } catch (err) {
        showToast(err.message, true);
      }
    });
  }
}

function newVoyageForm(vessels) {
  const options = vessels.map((v) => `<option value="${v.id}">${v.name}</option>`).join('');
  return `
    <form id="new-voyage-form" class="form-grid">
      <div class="field">
        <label>Vessel</label>
        <select name="vessel_id" required>${options}</select>
      </div>
      <div class="field">
        <label>Reference</label>
        <input name="reference" placeholder="e.g. VOY-2026-001" />
      </div>
      <div class="field">
        <label>Charterer</label>
        <input name="charterer" placeholder="Charterer name" />
      </div>
      <div class="field">
        <label>Status</label>
        <select name="status">
          <option value="PLANNED">Planned</option>
          <option value="ONGOING">Ongoing</option>
          <option value="COMPLETED">Completed</option>
        </select>
      </div>
      <div class="field">
        <label>Cargo Type</label>
        <input name="cargo_type" placeholder="e.g. Iron Ore" />
      </div>
      <div class="field">
        <label>Cargo Quantity (MT)</label>
        <input name="cargo_quantity_mt" type="number" step="0.01" value="0" />
      </div>
      <div class="field">
        <label>Freight Type</label>
        <select name="freight_type">
          <option value="PER_MT">Per MT</option>
          <option value="LUMPSUM">Lumpsum</option>
        </select>
      </div>
      <div class="field">
        <label>Freight Rate (USD)</label>
        <input name="freight_rate" type="number" step="0.01" value="0" />
      </div>
      <div class="field">
        <label>Address Commission (%)</label>
        <input name="address_commission_pct" type="number" step="0.01" value="0" />
      </div>
      <div class="field">
        <label>Brokerage (%)</label>
        <input name="brokerage_pct" type="number" step="0.01" value="0" />
      </div>
      <div class="field">
        <label>Laycan Start</label>
        <input name="laycan_start" type="date" />
      </div>
      <div class="field">
        <label>Laycan End</label>
        <input name="laycan_end" type="date" />
      </div>
      <div class="field" style="grid-column: 1 / -1;">
        <label>Notes</label>
        <textarea name="notes" rows="2"></textarea>
      </div>
      <div class="form-actions" style="grid-column: 1 / -1;">
        <button type="submit" class="btn">Create Voyage</button>
      </div>
    </form>
  `;
}

// ---------- Vessels ----------

async function renderVessels() {
  const container = el('view-vessels');
  container.innerHTML = '<p class="text-muted">Loading...</p>';

  const vessels = await api('/vessels');
  state.vessels = vessels;

  container.innerHTML = `
    <div class="card">
      <div class="section-title"><h2>Add Vessel</h2></div>
      <form id="new-vessel-form" class="form-grid">
        <div class="field"><label>Name</label><input name="name" required placeholder="e.g. MV Ocean Star" /></div>
        <div class="field"><label>IMO Number</label><input name="imo_number" placeholder="IMO 1234567" /></div>
        <div class="field"><label>DWT</label><input name="dwt" type="number" step="0.01" value="0" /></div>
        <div class="field"><label>Speed Laden (kn)</label><input name="speed_laden_knots" type="number" step="0.01" value="0" /></div>
        <div class="field"><label>Speed Ballast (kn)</label><input name="speed_ballast_knots" type="number" step="0.01" value="0" /></div>
        <div class="field"><label>Consumption Laden (MT/day)</label><input name="consumption_laden_mt" type="number" step="0.01" value="0" /></div>
        <div class="field"><label>Consumption Ballast (MT/day)</label><input name="consumption_ballast_mt" type="number" step="0.01" value="0" /></div>
        <div class="field"><label>Consumption in Port (MT/day)</label><input name="consumption_port_mt" type="number" step="0.01" value="0" /></div>
        <div class="field"><label>Fuel Type</label><input name="fuel_type" value="IFO380" /></div>
        <div class="form-actions" style="grid-column: 1 / -1;">
          <button type="submit" class="btn">Add Vessel</button>
        </div>
      </form>
    </div>
    <div class="card">
      <div class="section-title"><h2>Fleet</h2></div>
      ${vesselsTable(vessels)}
    </div>
  `;

  el('new-vessel-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      await api('/vessels', {
        method: 'POST',
        body: JSON.stringify({
          name: data.name,
          imo_number: data.imo_number,
          dwt: Number(data.dwt || 0),
          speed_laden_knots: Number(data.speed_laden_knots || 0),
          speed_ballast_knots: Number(data.speed_ballast_knots || 0),
          consumption_laden_mt: Number(data.consumption_laden_mt || 0),
          consumption_ballast_mt: Number(data.consumption_ballast_mt || 0),
          consumption_port_mt: Number(data.consumption_port_mt || 0),
          fuel_type: data.fuel_type,
        }),
      });
      showToast('Vessel added');
      await renderVessels();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  container.querySelectorAll('.delete-vessel').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this vessel? This will also delete its voyages.')) return;
      try {
        await api(`/vessels/${btn.dataset.id}`, { method: 'DELETE' });
        showToast('Vessel deleted');
        await renderVessels();
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });
}

function vesselsTable(vessels) {
  if (!vessels.length) return '<div class="empty-state">No vessels yet. Add your first vessel above.</div>';
  const rows = vessels.map((v) => `
    <tr>
      <td>${v.name}</td>
      <td>${v.imo_number || '-'}</td>
      <td class="mono">${numberFmt(v.dwt, 0)}</td>
      <td class="mono">${numberFmt(v.speed_laden_knots)} / ${numberFmt(v.speed_ballast_knots)}</td>
      <td class="mono">${numberFmt(v.consumption_laden_mt)} / ${numberFmt(v.consumption_ballast_mt)} / ${numberFmt(v.consumption_port_mt)}</td>
      <td>${v.fuel_type}</td>
      <td><button class="btn danger small delete-vessel" data-id="${v.id}">Delete</button></td>
    </tr>
  `).join('');
  return `
    <table>
      <thead>
        <tr><th>Name</th><th>IMO</th><th>DWT</th><th>Speed L/B (kn)</th><th>Consumption L/B/Port</th><th>Fuel</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ---------- Voyage detail ----------

async function renderVoyageDetail(id) {
  const container = el('view-voyage-detail');
  container.innerHTML = '<p class="text-muted">Loading...</p>';

  let data;
  try {
    data = await api(`/voyages/${id}`);
  } catch (err) {
    container.innerHTML = `<div class="empty-state">${err.message}</div>`;
    return;
  }

  const { voyage, vessel, portsOfCall, bunkers, expenses, pnl } = data;
  el('view-title').textContent = voyage.reference || `Voyage #${voyage.id}`;

  container.innerHTML = `
    <button class="back-link" id="back-to-voyages">&larr; Back to voyages</button>

    <div class="grid-2">
      <div class="card">
        <div class="section-title">
          <h2>${voyage.reference || 'Voyage #' + voyage.id}</h2>
          <span class="badge ${voyage.status.toLowerCase()}">${voyage.status}</span>
        </div>
        <table>
          <tbody>
            <tr><td class="text-muted">Vessel</td><td>${vessel.name}</td></tr>
            <tr><td class="text-muted">Charterer</td><td>${voyage.charterer || '-'}</td></tr>
            <tr><td class="text-muted">Cargo</td><td>${voyage.cargo_type || '-'} &middot; ${numberFmt(voyage.cargo_quantity_mt, 0)} MT</td></tr>
            <tr><td class="text-muted">Freight</td><td>${voyage.freight_type === 'LUMPSUM' ? 'Lumpsum' : 'Per MT'} @ ${money(voyage.freight_rate)}</td></tr>
            <tr><td class="text-muted">Commission / Brokerage</td><td>${numberFmt(voyage.address_commission_pct)}% / ${numberFmt(voyage.brokerage_pct)}%</td></tr>
            <tr><td class="text-muted">Laycan</td><td>${voyage.laycan_start || '-'} &rarr; ${voyage.laycan_end || '-'}</td></tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <div class="section-title"><h2>Voyage P&amp;L</h2></div>
        ${pnlBreakdown(pnl)}
      </div>
    </div>

    <div class="card">
      <div class="section-title">
        <h3>Ports of Call</h3>
      </div>
      ${portsTable(portsOfCall)}
      ${addPortForm()}
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="section-title"><h3>Bunkers</h3></div>
        ${bunkersTable(bunkers)}
        ${addBunkerForm()}
      </div>
      <div class="card">
        <div class="section-title"><h3>Other Expenses</h3></div>
        ${expensesTable(expenses)}
        ${addExpenseForm()}
      </div>
    </div>
  `;

  el('back-to-voyages').addEventListener('click', () => { window.location.hash = '/voyages'; });

  bindPortForm(id);
  bindBunkerForm(id);
  bindExpenseForm(id);
  bindDeleteButtons(id);
}

function pnlBreakdown(pnl) {
  const row = (label, value, isTotal = false) => `
    <div class="${isTotal ? 'total' : ''}"><div class="label">${label}</div></div>
    <div class="${isTotal ? 'total' : ''}"><div class="value">${money(value)}</div></div>
  `;
  return `
    <div class="pnl-breakdown">
      ${row('Gross Freight', pnl.grossFreight)}
      ${row('Address Commission', -pnl.addressCommission)}
      ${row('Brokerage', -pnl.brokerage)}
      <div class="divider"></div>
      ${row('Net Freight', pnl.netFreight)}
      ${row('Bunker Costs', -pnl.totalBunkerCost)}
      ${row('Port Costs', -pnl.totalPortCost)}
      ${row('Other Expenses', -pnl.totalOtherExpenses)}
      <div class="divider"></div>
      ${row('Net Voyage Result', pnl.netVoyageResult, true)}
      <div class="divider"></div>
      <div class="label">Voyage Days (port + steaming)</div><div class="value">${numberFmt(pnl.voyageDays)}</div>
      <div class="label">TCE / Day</div><div class="value">${money(pnl.tcePerDay)}</div>
    </div>
  `;
}

function portsTable(ports) {
  if (!ports.length) return '<div class="empty-state">No ports of call added yet.</div>';
  const rows = ports.map((p) => `
    <tr>
      <td>${p.sequence_no}</td>
      <td>${p.port_name}</td>
      <td>${p.purpose}</td>
      <td class="mono">${numberFmt(p.distance_from_previous_nm, 0)}</td>
      <td>${p.eta || '-'}</td>
      <td>${p.etd || '-'}</td>
      <td class="mono">${numberFmt(p.port_days)}</td>
      <td class="mono">${money(p.port_cost)}</td>
      <td><button class="btn danger small delete-port" data-id="${p.id}">Delete</button></td>
    </tr>
  `).join('');
  return `<table><thead><tr><th>#</th><th>Port</th><th>Purpose</th><th>Distance (nm)</th><th>ETA</th><th>ETD</th><th>Port Days</th><th>Port Cost</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function addPortForm() {
  return `
    <form id="add-port-form" class="form-grid" style="margin-top:16px;">
      <div class="field"><label>Sequence #</label><input name="sequence_no" type="number" value="1" /></div>
      <div class="field"><label>Port Name</label><input name="port_name" required /></div>
      <div class="field">
        <label>Purpose</label>
        <select name="purpose">
          <option value="LOAD">Load</option>
          <option value="DISCHARGE">Discharge</option>
          <option value="BUNKER">Bunker</option>
          <option value="OTHER">Other</option>
        </select>
      </div>
      <div class="field"><label>Distance from Previous (nm)</label><input name="distance_from_previous_nm" type="number" step="0.1" value="0" /></div>
      <div class="field"><label>ETA</label><input name="eta" type="date" /></div>
      <div class="field"><label>ETD</label><input name="etd" type="date" /></div>
      <div class="field"><label>Port Days</label><input name="port_days" type="number" step="0.1" value="0" /></div>
      <div class="field"><label>Port Cost (USD)</label><input name="port_cost" type="number" step="0.01" value="0" /></div>
      <div class="form-actions" style="grid-column: 1 / -1;">
        <button type="submit" class="btn secondary">+ Add Port of Call</button>
      </div>
    </form>
  `;
}

function bunkersTable(bunkers) {
  if (!bunkers.length) return '<div class="empty-state">No bunker entries yet.</div>';
  const rows = bunkers.map((b) => `
    <tr>
      <td>${b.fuel_type}</td>
      <td>${b.location}</td>
      <td class="mono">${numberFmt(b.quantity_mt)}</td>
      <td class="mono">${money(b.price_per_mt)}</td>
      <td class="mono">${money(b.quantity_mt * b.price_per_mt)}</td>
      <td><button class="btn danger small delete-bunker" data-id="${b.id}">Delete</button></td>
    </tr>
  `).join('');
  return `<table><thead><tr><th>Fuel</th><th>Location</th><th>Qty (MT)</th><th>Price/MT</th><th>Total</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function addBunkerForm() {
  return `
    <form id="add-bunker-form" class="form-grid" style="margin-top:16px;">
      <div class="field">
        <label>Fuel Type</label>
        <select name="fuel_type">
          <option value="IFO380">IFO380</option>
          <option value="VLSFO">VLSFO</option>
          <option value="MGO">MGO</option>
        </select>
      </div>
      <div class="field">
        <label>Location</label>
        <select name="location">
          <option value="SEA">At Sea</option>
          <option value="PORT">In Port</option>
        </select>
      </div>
      <div class="field"><label>Quantity (MT)</label><input name="quantity_mt" type="number" step="0.01" value="0" /></div>
      <div class="field"><label>Price / MT (USD)</label><input name="price_per_mt" type="number" step="0.01" value="0" /></div>
      <div class="form-actions" style="grid-column: 1 / -1;">
        <button type="submit" class="btn secondary">+ Add Bunker Entry</button>
      </div>
    </form>
  `;
}

function expensesTable(expenses) {
  if (!expenses.length) return '<div class="empty-state">No other expenses yet.</div>';
  const rows = expenses.map((e) => `
    <tr>
      <td>${e.category}</td>
      <td>${e.description || '-'}</td>
      <td class="mono">${money(e.amount)}</td>
      <td><button class="btn danger small delete-expense" data-id="${e.id}">Delete</button></td>
    </tr>
  `).join('');
  return `<table><thead><tr><th>Category</th><th>Description</th><th>Amount</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function addExpenseForm() {
  return `
    <form id="add-expense-form" class="form-grid" style="margin-top:16px;">
      <div class="field">
        <label>Category</label>
        <select name="category">
          <option value="AGENCY">Agency Fees</option>
          <option value="CANAL">Canal Dues</option>
          <option value="INSURANCE">Insurance</option>
          <option value="OTHER">Other</option>
        </select>
      </div>
      <div class="field"><label>Description</label><input name="description" /></div>
      <div class="field"><label>Amount (USD)</label><input name="amount" type="number" step="0.01" value="0" /></div>
      <div class="form-actions" style="grid-column: 1 / -1;">
        <button type="submit" class="btn secondary">+ Add Expense</button>
      </div>
    </form>
  `;
}

function bindPortForm(voyageId) {
  el('add-port-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api(`/voyages/${voyageId}/ports`, {
        method: 'POST',
        body: JSON.stringify({
          sequence_no: Number(data.sequence_no || 1),
          port_name: data.port_name,
          purpose: data.purpose,
          distance_from_previous_nm: Number(data.distance_from_previous_nm || 0),
          eta: data.eta || null,
          etd: data.etd || null,
          port_days: Number(data.port_days || 0),
          port_cost: Number(data.port_cost || 0),
        }),
      });
      showToast('Port of call added');
      await renderVoyageDetail(voyageId);
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

function bindBunkerForm(voyageId) {
  el('add-bunker-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api(`/voyages/${voyageId}/bunkers`, {
        method: 'POST',
        body: JSON.stringify({
          fuel_type: data.fuel_type,
          location: data.location,
          quantity_mt: Number(data.quantity_mt || 0),
          price_per_mt: Number(data.price_per_mt || 0),
        }),
      });
      showToast('Bunker entry added');
      await renderVoyageDetail(voyageId);
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

function bindExpenseForm(voyageId) {
  el('add-expense-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api(`/voyages/${voyageId}/expenses`, {
        method: 'POST',
        body: JSON.stringify({
          category: data.category,
          description: data.description,
          amount: Number(data.amount || 0),
        }),
      });
      showToast('Expense added');
      await renderVoyageDetail(voyageId);
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

function bindDeleteButtons(voyageId) {
  document.querySelectorAll('.delete-port').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/voyages/${voyageId}/ports/${btn.dataset.id}`, { method: 'DELETE' });
        await renderVoyageDetail(voyageId);
      } catch (err) { showToast(err.message, true); }
    });
  });
  document.querySelectorAll('.delete-bunker').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/voyages/${voyageId}/bunkers/${btn.dataset.id}`, { method: 'DELETE' });
        await renderVoyageDetail(voyageId);
      } catch (err) { showToast(err.message, true); }
    });
  });
  document.querySelectorAll('.delete-expense').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/voyages/${voyageId}/expenses/${btn.dataset.id}`, { method: 'DELETE' });
        await renderVoyageDetail(voyageId);
      } catch (err) { showToast(err.message, true); }
    });
  });
}

// ---------- Init ----------

if (!window.location.hash) window.location.hash = '/dashboard';
router();
