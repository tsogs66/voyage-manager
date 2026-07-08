/**
 * UI wiring: tabs, dashboard, voyage register, estimator form.
 * The "worksheet UI + macro buttons" layer of the original workbook.
 */
(function () {
  "use strict";

  const { computeVoyage } = window.VoyageCalc;
  const { loadVoyages, saveVoyages, makeId } = window.VoyageStore;
  const { toCsv, fromCsv } = window.VoyageCsv;

  let voyages = loadVoyages();
  let sortKey = "voyageNo";
  let sortAsc = true;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const fmtMoney = (n) =>
    (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const fmtDays = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const INPUT_FIELDS = window.VoyageCsv.FIELDS;

  // ---------- navigation ----------
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      $$(".view").forEach((v) =>
        v.classList.toggle("active", v.id === "view-" + tab.dataset.view)
      );
      if (tab.dataset.view === "dashboard") renderDashboard();
      if (tab.dataset.view === "voyages") renderTable();
    });
  });

  function showView(name) {
    $$(".tab").find((t) => t.dataset.view === name)?.click();
  }

  // ---------- estimator form ----------
  const form = $("#estimator-form");

  function readForm() {
    const v = { id: $("#f-id").value || null };
    for (const f of INPUT_FIELDS) {
      const el = $("#f-" + f);
      if (el) v[f] = el.value;
    }
    return v;
  }

  function fillForm(v) {
    $("#f-id").value = v.id || "";
    for (const f of INPUT_FIELDS) {
      const el = $("#f-" + f);
      if (el) el.value = v[f] ?? "";
    }
    renderLiveResults();
  }

  function clearForm() {
    form.reset();
    $("#f-id").value = "";
    renderLiveResults();
  }

  function renderLiveResults() {
    const r = computeVoyage(readForm());
    $("#r-ballastDays").textContent = fmtDays(r.ballastDays);
    $("#r-ladenDays").textContent = fmtDays(r.ladenDays);
    $("#r-portDays").textContent = fmtDays(r.portDays);
    $("#r-totalDays").textContent = fmtDays(r.totalDays);
    $("#r-grossFreight").textContent = fmtMoney(r.grossFreight);
    $("#r-commission").textContent = fmtMoney(r.commission);
    $("#r-netFreight").textContent = fmtMoney(r.netFreight);
    $("#r-bunkerIfo").textContent = fmtMoney(r.bunkerIfo);
    $("#r-bunkerMgo").textContent = fmtMoney(r.bunkerMgo);
    $("#r-portCosts").textContent = fmtMoney(r.portCosts);
    $("#r-canalOther").textContent = fmtMoney(r.canalOther);
    $("#r-totalExpenses").textContent = fmtMoney(r.totalExpenses);
    $("#r-result").textContent = fmtMoney(r.result);
    $("#r-tce").textContent = fmtMoney(r.tce);
    const cls = r.result >= 0 ? "pos" : "neg";
    $("#r-result").className = "num " + cls;
    $("#r-tce").className = "num " + cls;
  }

  form.addEventListener("input", renderLiveResults);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = readForm();
    if (v.id) {
      const idx = voyages.findIndex((x) => x.id === v.id);
      if (idx >= 0) voyages[idx] = v;
      else voyages.push(v);
    } else {
      v.id = makeId();
      voyages.push(v);
    }
    saveVoyages(voyages);
    clearForm();
    showView("voyages");
  });

  $("#btn-reset").addEventListener("click", clearForm);

  // ---------- voyage register ----------
  function decorated() {
    return voyages.map((v) => ({ ...v, ...computeVoyage(v) }));
  }

  function renderTable() {
    const q = $("#voyage-search").value.trim().toLowerCase();
    let rows = decorated();
    if (q) {
      rows = rows.filter((v) =>
        [v.voyageNo, v.vessel, v.cargo, v.loadPort, v.dischPort, v.status]
          .join(" ").toLowerCase().includes(q)
      );
    }
    rows.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true });
      return sortAsc ? cmp : -cmp;
    });

    const tbody = $("#voyage-table tbody");
    tbody.innerHTML = "";
    for (const v of rows) {
      const tr = document.createElement("tr");
      const resCls = v.result >= 0 ? "pos" : "neg";
      const statusCls = String(v.status || "Estimate").replace(/\s+/g, "");
      tr.innerHTML = `
        <td>${esc(v.voyageNo)}</td>
        <td>${esc(v.vessel)}</td>
        <td>${esc(v.cargo)}</td>
        <td>${esc(v.loadPort)}</td>
        <td>${esc(v.dischPort)}</td>
        <td><span class="badge ${statusCls}">${esc(v.status || "Estimate")}</span></td>
        <td class="num">${fmtDays(v.totalDays)}</td>
        <td class="num">${fmtMoney(v.netFreight)}</td>
        <td class="num">${fmtMoney(v.totalExpenses)}</td>
        <td class="num ${resCls}">${fmtMoney(v.result)}</td>
        <td class="num ${resCls}">${fmtMoney(v.tce)}</td>
        <td>
          <button class="btn small" data-act="edit" data-id="${v.id}">Edit</button>
          <button class="btn small danger" data-act="del" data-id="${v.id}">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    }
    $("#voyages-empty").hidden = rows.length > 0;
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  $("#voyage-table").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const v = voyages.find((x) => x.id === btn.dataset.id);
    if (!v) return;
    if (btn.dataset.act === "edit") {
      fillForm(v);
      showView("estimator");
    } else if (btn.dataset.act === "del") {
      if (confirm(`Delete voyage ${v.voyageNo || ""}?`)) {
        voyages = voyages.filter((x) => x.id !== v.id);
        saveVoyages(voyages);
        renderTable();
      }
    }
  });

  $$("#voyage-table th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (sortKey === key) sortAsc = !sortAsc;
      else { sortKey = key; sortAsc = true; }
      renderTable();
    });
  });

  $("#voyage-search").addEventListener("input", renderTable);
  $("#btn-new-voyage").addEventListener("click", () => {
    clearForm();
    showView("estimator");
  });

  // ---------- CSV ----------
  $("#btn-export-csv").addEventListener("click", () => {
    const blob = new Blob([toCsv(voyages)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "voyages.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("#csv-file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const imported = fromCsv(text);
    if (!imported.length) {
      alert("No voyages found in that CSV. The first row must be a header matching the export format.");
    } else {
      for (const v of imported) {
        v.id = makeId();
        voyages.push(v);
      }
      saveVoyages(voyages);
      renderTable();
      alert(`Imported ${imported.length} voyage(s).`);
    }
    e.target.value = "";
  });

  // ---------- dashboard ----------
  function renderDashboard() {
    const rows = decorated();
    const sum = (fn) => rows.reduce((acc, v) => acc + fn(v), 0);

    $("#kpi-count").textContent = rows.length;
    $("#kpi-freight").textContent = fmtMoney(sum((v) => v.netFreight));
    $("#kpi-expenses").textContent = fmtMoney(sum((v) => v.totalExpenses));
    const totalResult = sum((v) => v.result);
    const kpiResult = $("#kpi-result");
    kpiResult.textContent = fmtMoney(totalResult);
    kpiResult.className = "kpi-value " + (totalResult >= 0 ? "pos" : "neg");
    const totalDays = sum((v) => v.totalDays);
    $("#kpi-tce").textContent = fmtMoney(totalDays > 0 ? totalResult / totalDays : 0);

    // bar chart
    const chart = $("#dash-chart");
    chart.innerHTML = "";
    $("#dash-empty").hidden = rows.length > 0;
    const maxAbs = Math.max(1, ...rows.map((v) => Math.abs(v.result)));
    for (const v of rows) {
      const row = document.createElement("div");
      row.className = "bar-row";
      const pct = (Math.abs(v.result) / maxAbs) * 100;
      row.innerHTML = `
        <span class="bar-label">${esc(v.voyageNo || v.vessel || "—")}</span>
        <div class="bar-track"><div class="bar-fill ${v.result < 0 ? "neg" : ""}" style="width:${pct}%"></div></div>
        <span class="bar-value ${v.result >= 0 ? "pos" : "neg"}">${fmtMoney(v.result)}</span>`;
      chart.appendChild(row);
    }

    // status chips
    const counts = {};
    for (const v of rows) {
      const s = v.status || "Estimate";
      counts[s] = (counts[s] || 0) + 1;
    }
    const grid = $("#status-grid");
    grid.innerHTML = "";
    for (const [status, count] of Object.entries(counts)) {
      const chip = document.createElement("span");
      chip.className = "status-chip";
      chip.innerHTML = `${esc(status)}: <b>${count}</b>`;
      grid.appendChild(chip);
    }
    if (!rows.length) grid.innerHTML = '<span class="empty-hint">No data yet.</span>';
  }

  // ---------- init ----------
  renderLiveResults();
  renderDashboard();
  renderTable();
})();
