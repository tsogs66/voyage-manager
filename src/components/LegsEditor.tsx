import type { VoyageLeg } from '../lib/types'
import { newLeg } from '../lib/factory'
import { Button, Card, NumberInput, SectionHeader, Select, TextInput } from './ui'
import { PlusIcon, RouteIcon, TrashIcon } from './icons'

export function LegsEditor({
  legs,
  onChange,
}: {
  legs: VoyageLeg[]
  onChange: (legs: VoyageLeg[]) => void
}) {
  const update = (id: string, patch: Partial<VoyageLeg>) =>
    onChange(legs.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  const remove = (id: string) => onChange(legs.filter((l) => l.id !== id))
  const add = () => onChange([...legs, newLeg()])

  return (
    <Card>
      <SectionHeader
        title="Sailing Legs"
        subtitle="Distances & laden / ballast condition"
        icon={<RouteIcon />}
        action={
          <Button variant="subtle" onClick={add}>
            <PlusIcon /> Add leg
          </Button>
        }
      />
      <div className="p-5">
        <div className="hidden grid-cols-[1fr_1fr_90px_110px_110px_36px] gap-3 px-1 pb-2 text-xs font-medium text-slate-400 sm:grid">
          <span>From</span>
          <span>To</span>
          <span>Distance</span>
          <span>Condition</span>
          <span>Transit $</span>
          <span />
        </div>
        <div className="space-y-3">
          {legs.map((leg) => (
            <div
              key={leg.id}
              className="grid grid-cols-2 gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-3 sm:grid-cols-[1fr_1fr_90px_110px_110px_36px] sm:items-center sm:border-0 sm:bg-transparent sm:p-1"
            >
              <TextInput
                value={leg.from}
                onChange={(e) => update(leg.id, { from: e.target.value })}
                placeholder="Origin"
              />
              <TextInput
                value={leg.to}
                onChange={(e) => update(leg.id, { to: e.target.value })}
                placeholder="Destination"
              />
              <NumberInput
                value={leg.distanceNm}
                onValueChange={(n) => update(leg.id, { distanceNm: n })}
                className="pr-2"
              />
              <Select
                value={leg.laden ? 'laden' : 'ballast'}
                onChange={(e) =>
                  update(leg.id, { laden: e.target.value === 'laden' })
                }
              >
                <option value="laden">Laden</option>
                <option value="ballast">Ballast</option>
              </Select>
              <NumberInput
                value={leg.transitCost}
                onValueChange={(n) => update(leg.id, { transitCost: n })}
                className="pr-2"
              />
              <Button
                variant="danger"
                onClick={() => remove(leg.id)}
                aria-label="Remove leg"
                className="px-2"
              >
                <TrashIcon />
              </Button>
            </div>
          ))}
          {legs.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-400">
              No legs yet — add the ballast and laden passages.
            </p>
          )}
        </div>
      </div>
    </Card>
  )
}
