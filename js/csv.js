/**
 * CSV import/export — the migration path from the Excel workbook.
 * Export produces a header row matching the input field names; import
 * accepts the same format (extra columns are ignored), so a sheet saved
 * as CSV from Excel can be pulled straight in.
 */
(function (root) {
  "use strict";

  const FIELDS = [
    "voyageNo", "vessel", "status", "cargo", "loadPort", "dischPort",
    "cargoQty", "freightRate", "lumpsum", "commissionPct",
    "ballastDist", "ladenDist", "ballastSpeed", "ladenSpeed", "seaMargin",
    "loadDays", "dischDays", "idleDays",
    "seaConsIfo", "portConsIfo", "seaConsMgo", "portConsMgo",
    "priceIfo", "priceMgo",
    "portCostLoad", "portCostDisch", "canalDues", "otherCosts",
  ];

  function escapeCell(value) {
    const s = value == null ? "" : String(value);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(voyages) {
    const lines = [FIELDS.join(",")];
    for (const v of voyages) {
      lines.push(FIELDS.map((f) => escapeCell(v[f])).join(","));
    }
    return lines.join("\r\n");
  }

  /** Minimal RFC-4180 parser (handles quoted cells, embedded commas/newlines). */
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else inQuotes = false;
        } else {
          cell += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cell); cell = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        rows.push(row); row = [];
      } else {
        cell += ch;
      }
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
  }

  /** @returns {Array<object>} voyages parsed from CSV text (header row required). */
  function fromCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) return [];
    const header = rows[0].map((h) => h.trim());
    const voyages = [];
    for (const r of rows.slice(1)) {
      const v = {};
      header.forEach((h, i) => {
        if (FIELDS.includes(h)) v[h] = (r[i] ?? "").trim();
      });
      if (Object.keys(v).length) voyages.push(v);
    }
    return voyages;
  }

  root.VoyageCsv = { FIELDS, toCsv, fromCsv };
})(typeof self !== "undefined" ? self : this);
