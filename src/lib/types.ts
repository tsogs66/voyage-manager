export type FreightBasis = 'per_mt' | 'lumpsum'

/** A single port call in the voyage (load, discharge, etc.). */
export interface PortCall {
  id: string
  name: string
  /** 'load' | 'discharge' | 'other' — affects cargo handling only, all incur port time/cost */
  type: 'load' | 'discharge' | 'other'
  /** Days spent in port (turn time, waiting, laytime allowed). */
  days: number
  /** Total port disbursement / agency / dues in USD. */
  cost: number
  /** Cargo loaded (+) or discharged (-) here, in metric tonnes. Optional. */
  cargoMt?: number
}

/** A sailing leg between ports. */
export interface VoyageLeg {
  id: string
  from: string
  to: string
  /** Distance in nautical miles. */
  distanceNm: number
  /** Whether the vessel is laden (cargo aboard) or in ballast on this leg. */
  laden: boolean
  /** Canal / passage / other transit cost in USD for this leg. */
  transitCost: number
}

/** Vessel technical & commercial particulars. */
export interface Vessel {
  name: string
  dwt: number
  /** Speeds in knots. */
  ladenSpeed: number
  ballastSpeed: number
  /** Main-engine fuel (VLSFO/IFO) consumption at sea, MT/day. */
  seaConsumptionMainMt: number
  /** Aux / generator fuel (MGO/MDO) consumption at sea, MT/day. */
  seaConsumptionAuxMt: number
  /** Fuel consumed while in port (idle/working), MT/day (treated as aux/MGO). */
  portConsumptionMt: number
}

export interface Commercial {
  freightBasis: FreightBasis
  /** Freight rate in USD/MT when basis = per_mt. */
  freightRate: number
  /** Lumpsum freight in USD when basis = lumpsum. */
  lumpsum: number
  /** Cargo quantity in MT (used for per_mt freight and intake reporting). */
  cargoQuantityMt: number
  /** Address commission % (charterer/owner) deducted from gross freight. */
  addressCommissionPct: number
  /** Brokerage commission % deducted from gross freight. */
  brokerageCommissionPct: number
  /** Bunker prices in USD/MT. */
  mainFuelPrice: number
  auxFuelPrice: number
  /** Daily running / operating cost of the vessel (owner's opex) in USD/day. */
  dailyOpex: number
  /** Additional lump costs (insurance, extras) in USD. */
  miscCost: number
  /** Sea margin % added to steaming distance/time to allow for weather. */
  seaMarginPct: number
}

export interface Voyage {
  id: string
  reference: string
  charterer: string
  createdAt: number
  updatedAt: number
  vessel: Vessel
  commercial: Commercial
  legs: VoyageLeg[]
  ports: PortCall[]
}

/** Full computed result set, mirroring the outputs of a voyage-estimator spreadsheet. */
export interface VoyageResult {
  seaDaysLaden: number
  seaDaysBallast: number
  totalSeaDays: number
  totalPortDays: number
  totalVoyageDays: number

  totalDistanceNm: number
  ladenDistanceNm: number
  ballastDistanceNm: number

  mainFuelSeaMt: number
  auxFuelSeaMt: number
  portFuelMt: number
  totalMainFuelMt: number
  totalAuxFuelMt: number

  mainFuelCost: number
  auxFuelCost: number
  totalBunkerCost: number

  portCostTotal: number
  transitCostTotal: number
  miscCost: number

  grossFreight: number
  addressCommission: number
  brokerageCommission: number
  totalCommission: number
  netFreight: number

  /** Voyage costs excluding vessel opex/hire (bunkers + ports + canals + misc). */
  voyageCosts: number
  opexTotal: number
  totalCosts: number

  /** Net freight minus voyage costs (before opex) — the daily earning capacity. */
  voyageSurplus: number
  /** Time Charter Equivalent per day (surplus / total voyage days). */
  tcePerDay: number

  /** Final profit/loss after opex. */
  profit: number
  profitPerDay: number

  freightPerMt: number
}
