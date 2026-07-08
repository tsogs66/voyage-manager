/**
 * Voyage P&L / TCE calculation engine.
 *
 * This mirrors the logic typically found in shipping "voyage estimator"
 * Excel workbooks driven by VBA macros:
 *   Gross Freight -> less Address Commission -> less Brokerage -> Net Freight
 *   Net Freight - (Bunker Costs + Port Costs + Other Expenses) = Net Voyage Result
 *   Voyage Days = sum of port days + steaming days (derived from distances/speed)
 *   TCE per day = Net Voyage Result / Voyage Days
 */

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function computeGrossFreight(voyage) {
  if (voyage.freight_type === 'LUMPSUM') {
    return voyage.freight_rate;
  }
  // PER_MT
  return voyage.freight_rate * voyage.cargo_quantity_mt;
}

function computeSteamingDays(vessel, portsOfCall) {
  let totalDays = 0;
  for (const call of portsOfCall) {
    const distance = call.distance_from_previous_nm || 0;
    if (distance <= 0) continue;
    const speed = call.purpose === 'DISCHARGE' || call.purpose === 'BUNKER'
      ? (vessel.speed_ballast_knots || vessel.speed_laden_knots || 1)
      : (vessel.speed_laden_knots || vessel.speed_ballast_knots || 1);
    const speedToUse = speed > 0 ? speed : 1;
    totalDays += distance / (speedToUse * 24);
  }
  return totalDays;
}

function computeVoyagePnL({ vessel, voyage, portsOfCall, bunkers, expenses }) {
  const grossFreight = computeGrossFreight(voyage);
  const addressCommission = grossFreight * (voyage.address_commission_pct / 100);
  const brokerage = grossFreight * (voyage.brokerage_pct / 100);
  const netFreight = grossFreight - addressCommission - brokerage;

  const totalBunkerCost = bunkers.reduce(
    (sum, b) => sum + b.quantity_mt * b.price_per_mt,
    0
  );

  const totalPortCost = portsOfCall.reduce((sum, p) => sum + (p.port_cost || 0), 0);
  const totalOtherExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

  const totalPortDays = portsOfCall.reduce((sum, p) => sum + (p.port_days || 0), 0);
  const steamingDays = computeSteamingDays(vessel, portsOfCall);
  const voyageDays = round2(totalPortDays + steamingDays);

  const totalExpenses = totalBunkerCost + totalPortCost + totalOtherExpenses;
  const netVoyageResult = netFreight - totalExpenses;
  const tcePerDay = voyageDays > 0 ? netVoyageResult / voyageDays : 0;

  return {
    grossFreight: round2(grossFreight),
    addressCommission: round2(addressCommission),
    brokerage: round2(brokerage),
    netFreight: round2(netFreight),
    totalBunkerCost: round2(totalBunkerCost),
    totalPortCost: round2(totalPortCost),
    totalOtherExpenses: round2(totalOtherExpenses),
    totalExpenses: round2(totalExpenses),
    steamingDays: round2(steamingDays),
    totalPortDays: round2(totalPortDays),
    voyageDays,
    netVoyageResult: round2(netVoyageResult),
    tcePerDay: round2(tcePerDay),
  };
}

module.exports = { computeVoyagePnL, computeGrossFreight, computeSteamingDays, round2 };
