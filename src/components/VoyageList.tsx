import type { Voyage } from '../lib/types'
import { calcVoyage } from '../lib/calc'
import { usd } from '../lib/format'
import { Button } from './ui'
import { AnchorIcon, CopyIcon, PlusIcon, TrashIcon } from './icons'

export function VoyageList({
  voyages,
  activeId,
  onSelect,
  onNew,
  onDuplicate,
  onDelete,
}: {
  voyages: Voyage[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <aside className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-600 text-white">
          <AnchorIcon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-slate-800">Voyage Manager</h1>
          <p className="text-[11px] text-slate-400">Maritime estimator</p>
        </div>
      </div>

      <div className="px-4 pb-3">
        <Button onClick={onNew} className="w-full">
          <PlusIcon /> New voyage
        </Button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {voyages.map((v) => {
          const r = calcVoyage(v)
          const active = v.id === activeId
          return (
            <div
              key={v.id}
              onClick={() => onSelect(v.id)}
              className={`group cursor-pointer rounded-lg border px-3 py-2.5 transition ${
                active
                  ? 'border-sky-200 bg-sky-50'
                  : 'border-transparent hover:bg-slate-50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {v.reference || 'Untitled voyage'}
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    {v.vessel.name}
                    {v.charterer ? ` · ${v.charterer}` : ''}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                    r.profit >= 0
                      ? 'bg-emerald-50 text-emerald-600'
                      : 'bg-rose-50 text-rose-600'
                  }`}
                >
                  {usd(r.profit)}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDuplicate(v.id)
                  }}
                  className="rounded p-1 text-slate-400 hover:bg-white hover:text-sky-600"
                  aria-label="Duplicate voyage"
                >
                  <CopyIcon className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(v.id)
                  }}
                  className="rounded p-1 text-slate-400 hover:bg-white hover:text-rose-500"
                  aria-label="Delete voyage"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )
        })}
        {voyages.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-slate-400">
            No voyages yet. Create one to start estimating.
          </p>
        )}
      </nav>

      <div className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400">
        Saved locally in your browser
      </div>
    </aside>
  )
}
