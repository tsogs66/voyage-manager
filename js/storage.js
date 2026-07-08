/**
 * Persistence layer — replaces the workbook file itself.
 * Voyages are stored as JSON in localStorage under a single key.
 */
(function (root) {
  "use strict";

  const KEY = "voyage-manager:voyages";

  function loadVoyages() {
    try {
      const raw = localStorage.getItem(KEY);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function saveVoyages(voyages) {
    localStorage.setItem(KEY, JSON.stringify(voyages));
  }

  function makeId() {
    return "v_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  root.VoyageStore = { loadVoyages, saveVoyages, makeId };
})(typeof self !== "undefined" ? self : this);
