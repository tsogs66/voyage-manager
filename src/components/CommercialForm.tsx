import type { Commercial } from '../lib/types'
import { Card, Field, NumberInput, SectionHeader, Select } from './ui'
import { CoinsIcon } from './icons'

export function CommercialForm({
  commercial,
  onChange,
}: {
  commercial: Commercial
  onChange: (c: Commercial) => void
}) {
  const set = <K extends keyof Commercial>(key: K, value: Commercial[K]) =>
    onChange({ ...commercial, [key]: value })

  return (
    <Card>
      <SectionHeader
        title="Freight & Costs"
        subtitle="Revenue, commissions, bunker prices & opex"
        icon={<CoinsIcon />}
      />
      <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3">
        <Field label="Freight basis">
          <Select
            value={commercial.freightBasis}
            onChange={(e) =>
              set('freightBasis', e.target.value as Commercial['freightBasis'])
            }
          >
            <option value="per_mt">Per MT</option>
            <option value="lumpsum">Lumpsum</option>
          </Select>
        </Field>

        {commercial.freightBasis === 'per_mt' ? (
          <>
            <Field label="Freight rate" suffix="$/MT">
              <NumberInput
                value={commercial.freightRate}
                onValueChange={(n) => set('freightRate', n)}
                step="0.01"
              />
            </Field>
            <Field label="Cargo quantity" suffix="MT">
              <NumberInput
                value={commercial.cargoQuantityMt}
                onValueChange={(n) => set('cargoQuantityMt', n)}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Lumpsum freight" suffix="$">
              <NumberInput
                value={commercial.lumpsum}
                onValueChange={(n) => set('lumpsum', n)}
              />
            </Field>
            <Field label="Cargo quantity" suffix="MT">
              <NumberInput
                value={commercial.cargoQuantityMt}
                onValueChange={(n) => set('cargoQuantityMt', n)}
              />
            </Field>
          </>
        )}

        <Field label="Address comm." suffix="%">
          <NumberInput
            value={commercial.addressCommissionPct}
            onValueChange={(n) => set('addressCommissionPct', n)}
            step="0.01"
          />
        </Field>
        <Field label="Brokerage" suffix="%">
          <NumberInput
            value={commercial.brokerageCommissionPct}
            onValueChange={(n) => set('brokerageCommissionPct', n)}
            step="0.01"
          />
        </Field>
        <Field label="Sea margin" suffix="%">
          <NumberInput
            value={commercial.seaMarginPct}
            onValueChange={(n) => set('seaMarginPct', n)}
            step="0.5"
          />
        </Field>

        <Field label="Main fuel price" suffix="$/MT">
          <NumberInput
            value={commercial.mainFuelPrice}
            onValueChange={(n) => set('mainFuelPrice', n)}
          />
        </Field>
        <Field label="Aux fuel price" suffix="$/MT">
          <NumberInput
            value={commercial.auxFuelPrice}
            onValueChange={(n) => set('auxFuelPrice', n)}
          />
        </Field>
        <Field label="Daily opex / hire" suffix="$/d">
          <NumberInput
            value={commercial.dailyOpex}
            onValueChange={(n) => set('dailyOpex', n)}
          />
        </Field>
        <Field label="Misc / extra costs" suffix="$">
          <NumberInput
            value={commercial.miscCost}
            onValueChange={(n) => set('miscCost', n)}
          />
        </Field>
      </div>
    </Card>
  )
}
