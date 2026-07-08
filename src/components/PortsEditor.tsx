import type { PortCall } from '../lib/types'
import { newPort } from '../lib/factory'
import { Button, Card, NumberInput, SectionHeader, Select, TextInput } from './ui'
import { DockIcon, PlusIcon, TrashIcon } from './icons'

export function PortsEditor({
  ports,
  onChange,
}: {
  ports: PortCall[]
  onChange: (ports: PortCall[]) => void
}) {
  const update = (id: string, patch: Partial<PortCall>) =>
    onChange(ports.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  const remove = (id: string) => onChange(ports.filter((p) => p.id !== id))
  const add = () => onChange([...ports, newPort({ type: 'discharge' })])

  return (
    <Card>
      <SectionHeader
        title="Port Calls"
        subtitle="Turn time & disbursements"
        icon={<DockIcon />}
        action={
          <Button variant="subtle" onClick={add}>
            <PlusIcon /> Add port
          </Button>
        }
      />
      <div className="p-5">
        <div className="hidden grid-cols-[1fr_120px_90px_120px_36px] gap-3 px-1 pb-2 text-xs font-medium text-slate-400 sm:grid">
          <span>Port</span>
          <span>Type</span>
          <span>Days</span>
          <span>Cost $</span>
          <span />
        </div>
        <div className="space-y-3">
          {ports.map((p) => (
            <div
              key={p.id}
              className="grid grid-cols-2 gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-3 sm:grid-cols-[1fr_120px_90px_120px_36px] sm:items-center sm:border-0 sm:bg-transparent sm:p-1"
            >
              <TextInput
                value={p.name}
                onChange={(e) => update(p.id, { name: e.target.value })}
                placeholder="Port name"
              />
              <Select
                value={p.type}
                onChange={(e) =>
                  update(p.id, { type: e.target.value as PortCall['type'] })
                }
              >
                <option value="load">Load</option>
                <option value="discharge">Discharge</option>
                <option value="other">Other</option>
              </Select>
              <NumberInput
                value={p.days}
                onValueChange={(n) => update(p.id, { days: n })}
                step="0.1"
                className="pr-2"
              />
              <NumberInput
                value={p.cost}
                onValueChange={(n) => update(p.id, { cost: n })}
                className="pr-2"
              />
              <Button
                variant="danger"
                onClick={() => remove(p.id)}
                aria-label="Remove port"
                className="px-2"
              >
                <TrashIcon />
              </Button>
            </div>
          ))}
          {ports.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-400">
              No port calls yet — add load and discharge ports.
            </p>
          )}
        </div>
      </div>
    </Card>
  )
}
