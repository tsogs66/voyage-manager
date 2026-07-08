import type { Commercial, PortCall, Vessel, Voyage, VoyageLeg } from './types'

export const uid = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export function defaultVessel(): Vessel {
  return {
    name: 'MV Voyager',
    dwt: 55000,
    ladenSpeed: 13,
    ballastSpeed: 14,
    seaConsumptionMainMt: 26,
    seaConsumptionAuxMt: 0.1,
    portConsumptionMt: 3,
  }
}

export function defaultCommercial(): Commercial {
  return {
    freightBasis: 'per_mt',
    freightRate: 28,
    lumpsum: 0,
    cargoQuantityMt: 52000,
    addressCommissionPct: 2.5,
    brokerageCommissionPct: 1.25,
    mainFuelPrice: 620,
    auxFuelPrice: 850,
    dailyOpex: 6500,
    miscCost: 15000,
    seaMarginPct: 5,
  }
}

export function newLeg(partial?: Partial<VoyageLeg>): VoyageLeg {
  return {
    id: uid(),
    from: '',
    to: '',
    distanceNm: 0,
    laden: true,
    transitCost: 0,
    ...partial,
  }
}

export function newPort(partial?: Partial<PortCall>): PortCall {
  return {
    id: uid(),
    name: '',
    type: 'load',
    days: 1,
    cost: 0,
    cargoMt: 0,
    ...partial,
  }
}

export function newVoyage(): Voyage {
  const now = Date.now()
  return {
    id: uid(),
    reference: 'New Voyage',
    charterer: '',
    createdAt: now,
    updatedAt: now,
    vessel: defaultVessel(),
    commercial: defaultCommercial(),
    legs: [
      newLeg({ from: 'Ballast port', to: 'Load port', distanceNm: 1200, laden: false }),
      newLeg({ from: 'Load port', to: 'Discharge port', distanceNm: 5400, laden: true, transitCost: 0 }),
    ],
    ports: [
      newPort({ name: 'Load port', type: 'load', days: 2.5, cost: 45000, cargoMt: 52000 }),
      newPort({ name: 'Discharge port', type: 'discharge', days: 3, cost: 60000, cargoMt: -52000 }),
    ],
  }
}

/** A ready-made sample so the app is useful on first launch. */
export function sampleVoyage(): Voyage {
  const v = newVoyage()
  v.reference = 'Santos → Qingdao (Soybeans)'
  v.charterer = 'Global Grain Traders'
  v.vessel.name = 'MV Southern Cross'
  return v
}
