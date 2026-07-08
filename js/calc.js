/**
 * Voyage calculation engine.
 *
 * This module replaces the worksheet formulas / VBA macros of the original
 * Excel voyage-estimating workbook. Given a voyage's raw inputs it derives
 * days, freight, expenses, result and TCE.
 *
 * Works both in the browser (attached to window) and in Node (module.exports)
 * so the maths can be unit-tested from the command line.
 */
(function (root) {
  "use strict";

  const num = (v) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  /**
   * @param {object} v raw voyage inputs (strings or numbers)
   * @returns {object} derived figures, all numbers
   */
  function computeVoyage(v) {
    // --- days ---
    const ballastSpeed = num(v.ballastSpeed);
    const ladenSpeed = num(v.ladenSpeed);
    const marginFactor = 1 + num(v.seaMargin) / 100;

    const ballastDays = ballastSpeed > 0
      ? (num(v.ballastDist) / (ballastSpeed * 24)) * marginFactor
      : 0;
    const ladenDays = ladenSpeed > 0
      ? (num(v.ladenDist) / (ladenSpeed * 24)) * marginFactor
      : 0;

    const seaDays = ballastDays + ladenDays;
    const portDays = num(v.loadDays) + num(v.dischDays) + num(v.idleDays);
    const totalDays = seaDays + portDays;

    // --- revenue ---
    const grossFreight = num(v.cargoQty) * num(v.freightRate) + num(v.lumpsum);
    const commission = grossFreight * (num(v.commissionPct) / 100);
    const netFreight = grossFreight - commission;

    // --- bunkers ---
    const bunkerIfo =
      (seaDays * num(v.seaConsIfo) + portDays * num(v.portConsIfo)) * num(v.priceIfo);
    const bunkerMgo =
      (seaDays * num(v.seaConsMgo) + portDays * num(v.portConsMgo)) * num(v.priceMgo);

    // --- other expenses ---
    const portCosts = num(v.portCostLoad) + num(v.portCostDisch);
    const canalOther = num(v.canalDues) + num(v.otherCosts);

    const totalExpenses = bunkerIfo + bunkerMgo + portCosts + canalOther;
    const result = netFreight - totalExpenses;
    const tce = totalDays > 0 ? result / totalDays : 0;

    return {
      ballastDays,
      ladenDays,
      seaDays,
      portDays,
      totalDays,
      grossFreight,
      commission,
      netFreight,
      bunkerIfo,
      bunkerMgo,
      portCosts,
      canalOther,
      totalExpenses,
      result,
      tce,
    };
  }

  const api = { computeVoyage, num };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.VoyageCalc = api;
  }
})(typeof self !== "undefined" ? self : this);
