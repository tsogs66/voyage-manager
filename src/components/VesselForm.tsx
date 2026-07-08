import type { Vessel } from '../lib/types'
import { Card, Field, NumberInput, SectionHeader, TextInput } from './ui'
import { ShipIcon } from './icons'

export function VesselForm({
  vessel,
  onChange,
}: {
  vessel: Vessel
  onChange: (v: Vessel) => void
}) {
  const set = <K extends keyof Vessel>(key: K, value: Vessel[K]) =>
    onChange({ ...vessel, [key]: value })

  return (
    <Card>
      <SectionHeader
        title="Vessel Particulars"
        subtitle="Speed & consumption profile"
        icon={<ShipIcon />}
      />
      <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3">
        <div className="col-span-2 sm:col-span-3">
          <Field label="Vessel name">
            <TextInput
              value={vessel.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. MV Southern Cross"
            />
          </Field>
        </div>
        <Field label="Deadweight" suffix="MT">
          <NumberInput value={vessel.dwt} onValueChange={(n) => set('dwt', n)} />
        </Field>
        <Field label="Laden speed" suffix="kn">
          <NumberInput
            value={vessel.ladenSpeed}
            onValueChange={(n) => set('ladenSpeed', n)}
            step="0.1"
          />
        </Field>
        <Field label="Ballast speed" suffix="kn">
          <NumberInput
            value={vessel.ballastSpeed}
            onValueChange={(n) => set('ballastSpeed', n)}
            step="0.1"
          />
        </Field>
        <Field label="Main fuel @ sea" suffix="MT/d">
          <NumberInput
            value={vessel.seaConsumptionMainMt}
            onValueChange={(n) => set('seaConsumptionMainMt', n)}
            step="0.1"
          />
        </Field>
        <Field label="Aux fuel @ sea" suffix="MT/d">
          <NumberInput
            value={vessel.seaConsumptionAuxMt}
            onValueChange={(n) => set('seaConsumptionAuxMt', n)}
            step="0.1"
          />
        </Field>
        <Field label="Fuel in port" suffix="MT/d">
          <NumberInput
            value={vessel.portConsumptionMt}
            onValueChange={(n) => set('portConsumptionMt', n)}
            step="0.1"
          />
        </Field>
      </div>
    </Card>
  )
}
