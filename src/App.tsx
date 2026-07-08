import { useEffect, useMemo, useState } from 'react'
import type { Voyage } from './lib/types'
import { calcVoyage } from './lib/calc'
import { loadVoyages, saveVoyages } from './lib/storage'
import { newVoyage, uid } from './lib/factory'
import { VoyageList } from './components/VoyageList'
import { VesselForm } from './components/VesselForm'
import { CommercialForm } from './components/CommercialForm'
import { LegsEditor } from './components/LegsEditor'
import { PortsEditor } from './components/PortsEditor'
import { ResultsPanel } from './components/ResultsPanel'
import { TextInput } from './components/ui'

export default function App() {
  const [voyages, setVoyages] = useState<Voyage[]>(() => loadVoyages())
  const [activeId, setActiveId] = useState<string | null>(
    () => loadVoyages()[0]?.id ?? null,
  )
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    saveVoyages(voyages)
  }, [voyages])

  const active = useMemo(
    () => voyages.find((v) => v.id === activeId) ?? null,
    [voyages, activeId],
  )

  const result = useMemo(
    () => (active ? calcVoyage(active) : null),
    [active],
  )

  const patchActive = (patch: Partial<Voyage>) => {
    if (!active) return
    setVoyages((prev) =>
      prev.map((v) =>
        v.id === active.id ? { ...v, ...patch, updatedAt: Date.now() } : v,
      ),
    )
  }

  const handleNew = () => {
    const v = newVoyage()
    setVoyages((prev) => [v, ...prev])
    setActiveId(v.id)
    setSidebarOpen(false)
  }

  const handleDuplicate = (id: string) => {
    const src = voyages.find((v) => v.id === id)
    if (!src) return
    const copy: Voyage = {
      ...structuredClone(src),
      id: uid(),
      reference: `${src.reference} (copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    setVoyages((prev) => [copy, ...prev])
    setActiveId(copy.id)
  }

  const handleDelete = (id: string) => {
    setVoyages((prev) => {
      const next = prev.filter((v) => v.id !== id)
      if (id === activeId) setActiveId(next[0]?.id ?? null)
      return next
    })
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-30 w-72 border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <VoyageList
          voyages={voyages}
          activeId={activeId}
          onSelect={(id) => {
            setActiveId(id)
            setSidebarOpen(false)
          }}
          onNew={handleNew}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
        />
      </div>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-slate-900/30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {active && result ? (
          <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8">
            <header className="mb-6 flex flex-wrap items-center gap-3">
              <button
                className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 lg:hidden"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open menu"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-5 w-5"
                >
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
              <div className="flex-1">
                <TextInput
                  value={active.reference}
                  onChange={(e) => patchActive({ reference: e.target.value })}
                  className="!border-transparent !bg-transparent !px-0 !text-xl !font-bold hover:!bg-white focus:!border-slate-200 focus:!bg-white focus:!px-3"
                  placeholder="Voyage reference"
                />
              </div>
              <div className="w-full sm:w-64">
                <TextInput
                  value={active.charterer}
                  onChange={(e) => patchActive({ charterer: e.target.value })}
                  placeholder="Charterer"
                />
              </div>
            </header>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]">
              <div className="space-y-6">
                <VesselForm
                  vessel={active.vessel}
                  onChange={(vessel) => patchActive({ vessel })}
                />
                <CommercialForm
                  commercial={active.commercial}
                  onChange={(commercial) => patchActive({ commercial })}
                />
                <LegsEditor
                  legs={active.legs}
                  onChange={(legs) => patchActive({ legs })}
                />
                <PortsEditor
                  ports={active.ports}
                  onChange={(ports) => patchActive({ ports })}
                />
              </div>

              <div className="lg:sticky lg:top-6 lg:self-start">
                <ResultsPanel r={result} />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="text-slate-500">No voyage selected.</p>
            <button
              onClick={handleNew}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
            >
              Create a voyage
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
