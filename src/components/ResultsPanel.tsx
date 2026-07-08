import type { VoyageResult } from '../lib/types'
import { num, usd } from '../lib/format'
import { Card, SectionHeader } from './ui'
import { ChartIcon } from './icons'

function Row({
  label,
  value,
  strong = false,
  muted = false,
}: {
  label: string
  value: string
  strong?: boolean
  muted?: boolean
}) {
  return (
    <div
      className={`flex items-center justify-between py-1.5 text-sm ${
        strong ? 'font-semibold text-slate-800' : ''
      } ${muted ? 'text-slate-400' : 'text-slate-600'}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-slate-100 px-5 py-3 first:border-t-0">
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </h3>
      {children}
    </div>
  )
}

export function ResultsPanel({ r }: { r: VoyageResult }) {
  const profitable = r.profit >= 0

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div
          className={`px-5 py-5 ${
            profitable
              ? 'bg-gradient-to-br from-emerald-500 to-teal-600'
              : 'bg-gradient-to-br from-rose-500 to-red-600'
          } text-white`}
        >
          <p className="text-xs font-medium uppercase tracking-wide opacity-80">
            Voyage {profitable ? 'Profit' : 'Loss'}
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{usd(r.profit)}</p>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm opacity-90">
            <span>
              TCE <b className="tabular-nums">{usd(r.tcePerDay)}/day</b>
            </span>
            <span>
              Result <b className="tabular-nums">{usd(r.profitPerDay)}/day</b>
            </span>
            <span>
              Duration{' '}
              <b className="tabular-nums">{num(r.totalVoyageDays, 1)} days</b>
            </span>
          </div>
        </div>
      </Card>

      <Card>
        <SectionHeader
          title="Estimate Breakdown"
          subtitle="Time, bunkers, revenue & result"
          icon={<ChartIcon />}
        />

        <Group title="Time & Distance">
          <Row label="Distance (laden)" value={`${num(r.ladenDistanceNm, 0)} nm`} />
          <Row
            label="Distance (ballast)"
            value={`${num(r.ballastDistanceNm, 0)} nm`}
          />
          <Row label="Sea days (laden)" value={num(r.seaDaysLaden, 2)} />
          <Row label="Sea days (ballast)" value={num(r.seaDaysBallast, 2)} />
          <Row label="Port days" value={num(r.totalPortDays, 2)} />
          <Row
            label="Total voyage days"
            value={num(r.totalVoyageDays, 2)}
            strong
          />
        </Group>

        <Group title="Bunkers">
          <Row
            label={`Main fuel (${num(r.totalMainFuelMt, 1)} MT)`}
            value={usd(r.mainFuelCost)}
          />
          <Row
            label={`Aux fuel (${num(r.totalAuxFuelMt, 1)} MT)`}
            value={usd(r.auxFuelCost)}
          />
          <Row label="Total bunker cost" value={usd(r.totalBunkerCost)} strong />
        </Group>

        <Group title="Revenue">
          <Row label="Gross freight" value={usd(r.grossFreight)} />
          <Row
            label="Address commission"
            value={`- ${usd(r.addressCommission)}`}
            muted
          />
          <Row
            label="Brokerage"
            value={`- ${usd(r.brokerageCommission)}`}
            muted
          />
          <Row label="Net freight" value={usd(r.netFreight)} strong />
          <Row label="Freight / MT" value={usd(r.freightPerMt, 2)} muted />
        </Group>

        <Group title="Costs">
          <Row label="Bunkers" value={usd(r.totalBunkerCost)} />
          <Row label="Port costs" value={usd(r.portCostTotal)} />
          <Row label="Canal / transit" value={usd(r.transitCostTotal)} />
          <Row label="Misc / extras" value={usd(r.miscCost)} />
          <Row label="Voyage costs" value={usd(r.voyageCosts)} strong />
          <Row
            label={`Opex / hire (${num(r.totalVoyageDays, 1)} d)`}
            value={usd(r.opexTotal)}
          />
          <Row label="Total costs" value={usd(r.totalCosts)} strong />
        </Group>

        <Group title="Result">
          <Row label="Net freight" value={usd(r.netFreight)} />
          <Row label="Voyage surplus (pre-opex)" value={usd(r.voyageSurplus)} />
          <Row
            label="TCE per day"
            value={usd(r.tcePerDay)}
            strong
          />
          <Row
            label="Profit / (loss)"
            value={usd(r.profit)}
            strong
          />
        </Group>
      </Card>
    </div>
  )
}
