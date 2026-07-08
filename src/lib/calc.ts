import type { Commercial, Vessel, Voyage, VoyageLeg, VoyageResult, PortCall } from './types'

/**
 * Voyage estimator calculation engine.
 *
 * This is a faithful port of the logic found in a typical VBA-coded maritime
 * "voyage estimator" Excel spreadsheet. The classic workbook computes steaming
 * time from distance and speed, applies a weather (sea) margin, derives bunker
 * consumption at sea and in port, totals freight revenue net of commissions,
 * sums voyage costs, and reports profit and Time Charter Equivalent (TCE).
 */

const HOURS_PER_DAY = 24
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Steaming days for a leg = distance / (speed * 24), inflated by the sea margin. */
function legSeaDays(distanceNm: number, speedKnots: number, seaMarginPct: number): number {
  if (speedKnots <= 0 || distanceNm <= 0) return 0
  const baseDays = distanceNm / (speedKnots * HOURS_PER_DAY)
  return baseDays * (1 + seaMarginPct / 100)
}

export function calculateVoyage(
  vessel: Vessel,
  commercial: Commercial,
  legs: VoyageLeg[],
  ports: PortCall[],
): VoyageResult {
  const margin = commercial.seaMarginPct

  // --- Steaming time & distance -------------------------------------------
  let seaDaysLaden = 0
  let seaDaysBallast = 0
  let ladenDistanceNm = 0
  let ballastDistanceNm = 0
  let transitCostTotal = 0

  for (const leg of legs) {
    const speed = leg.laden ? vessel.ladenSpeed : vessel.ballastSpeed
    const days = legSeaDays(leg.distanceNm, speed, margin)
    if (leg.laden) {
      seaDaysLaden += days
      ladenDistanceNm += leg.distanceNm
    } else {
      seaDaysBallast += days
      ballastDistanceNm += leg.distanceNm
    }
    transitCostTotal += leg.transitCost || 0
  }

  const totalSeaDays = seaDaysLaden + seaDaysBallast
  const totalDistanceNm = ladenDistanceNm + ballastDistanceNm

  // --- Port time & cost ---------------------------------------------------
  let totalPortDays = 0
  let portCostTotal = 0
  for (const p of ports) {
    totalPortDays += p.days || 0
    portCostTotal += p.cost || 0
  }

  const totalVoyageDays = totalSeaDays + totalPortDays

  // --- Bunker consumption -------------------------------------------------
  const mainFuelSeaMt = totalSeaDays * vessel.seaConsumptionMainMt
  const auxFuelSeaMt = totalSeaDays * vessel.seaConsumptionAuxMt
  const portFuelMt = totalPortDays * vessel.portConsumptionMt

  const totalMainFuelMt = mainFuelSeaMt
  const totalAuxFuelMt = auxFuelSeaMt + portFuelMt

  const mainFuelCost = totalMainFuelMt * commercial.mainFuelPrice
  const auxFuelCost = totalAuxFuelMt * commercial.auxFuelPrice
  const totalBunkerCost = mainFuelCost + auxFuelCost

  // --- Revenue ------------------------------------------------------------
  const grossFreight =
    commercial.freightBasis === 'lumpsum'
      ? commercial.lumpsum
      : commercial.cargoQuantityMt * commercial.freightRate

  const addressCommission = grossFreight * (commercial.addressCommissionPct / 100)
  const brokerageCommission = grossFreight * (commercial.brokerageCommissionPct / 100)
  const totalCommission = addressCommission + brokerageCommission
  const netFreight = grossFreight - totalCommission

  // --- Costs & results ----------------------------------------------------
  const miscCost = commercial.miscCost || 0
  const voyageCosts = totalBunkerCost + portCostTotal + transitCostTotal + miscCost
  const opexTotal = totalVoyageDays * (commercial.dailyOpex || 0)
  const totalCosts = voyageCosts + opexTotal

  const voyageSurplus = netFreight - voyageCosts
  const tcePerDay = totalVoyageDays > 0 ? voyageSurplus / totalVoyageDays : 0

  const profit = netFreight - totalCosts
  const profitPerDay = totalVoyageDays > 0 ? profit / totalVoyageDays : 0

  const freightPerMt =
    commercial.cargoQuantityMt > 0 ? grossFreight / commercial.cargoQuantityMt : 0

  return {
    seaDaysLaden: round2(seaDaysLaden),
    seaDaysBallast: round2(seaDaysBallast),
    totalSeaDays: round2(totalSeaDays),
    totalPortDays: round2(totalPortDays),
    totalVoyageDays: round2(totalVoyageDays),

    totalDistanceNm: round2(totalDistanceNm),
    ladenDistanceNm: round2(ladenDistanceNm),
    ballastDistanceNm: round2(ballastDistanceNm),

    mainFuelSeaMt: round2(mainFuelSeaMt),
    auxFuelSeaMt: round2(auxFuelSeaMt),
    portFuelMt: round2(portFuelMt),
    totalMainFuelMt: round2(totalMainFuelMt),
    totalAuxFuelMt: round2(totalAuxFuelMt),

    mainFuelCost: round2(mainFuelCost),
    auxFuelCost: round2(auxFuelCost),
    totalBunkerCost: round2(totalBunkerCost),

    portCostTotal: round2(portCostTotal),
    transitCostTotal: round2(transitCostTotal),
    miscCost: round2(miscCost),

    grossFreight: round2(grossFreight),
    addressCommission: round2(addressCommission),
    brokerageCommission: round2(brokerageCommission),
    totalCommission: round2(totalCommission),
    netFreight: round2(netFreight),

    voyageCosts: round2(voyageCosts),
    opexTotal: round2(opexTotal),
    totalCosts: round2(totalCosts),

    voyageSurplus: round2(voyageSurplus),
    tcePerDay: round2(tcePerDay),

    profit: round2(profit),
    profitPerDay: round2(profitPerDay),

    freightPerMt: round2(freightPerMt),
  }
}

export function calcVoyage(v: Voyage): VoyageResult {
  return calculateVoyage(v.vessel, v.commercial, v.legs, v.ports)
}
