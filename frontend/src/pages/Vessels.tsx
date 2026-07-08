import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vesselApi, type Vessel } from '../api';
import Modal from '../components/Modal';
import { Plus, Pencil, Trash2, Ship } from 'lucide-react';
import { formatNumber, STATUS_COLORS, STATUS_LABELS } from '../utils';
import toast from 'react-hot-toast';

const VESSEL_TYPES = ['Bulk Carrier', 'Container Ship', 'Tanker', 'General Cargo', 'LNG Carrier', 'Car Carrier', 'RoRo', 'Passenger', 'Other'];
const FLAGS = ['Panama', 'Liberia', 'Marshall Islands', 'Singapore', 'Bahamas', 'Malta', 'Cyprus', 'Hong Kong', 'Greece', 'Norway', 'USA', 'China', 'Japan'];

const empty: Partial<Vessel> = { name: '', imo_number: '', vessel_type: '', flag: '', status: 'active' };

export default function Vessels() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; editing?: Vessel }>({ open: false });
  const [form, setForm] = useState<Partial<Vessel>>(empty);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const { data: vessels = [], isLoading } = useQuery({ queryKey: ['vessels'], queryFn: vesselApi.list });

  const createMut = useMutation({
    mutationFn: vesselApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vessels'] }); toast.success('Vessel created'); setModal({ open: false }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Error'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Vessel> }) => vesselApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vessels'] }); toast.success('Vessel updated'); setModal({ open: false }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Error'),
  });

  const deleteMut = useMutation({
    mutationFn: vesselApi.delete,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vessels'] }); toast.success('Vessel deleted'); setDeleteConfirm(null); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Cannot delete vessel with voyages'),
  });

  const openCreate = () => { setForm(empty); setModal({ open: true }); };
  const openEdit = (v: Vessel) => { setForm({ ...v }); setModal({ open: true, editing: v }); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (modal.editing) updateMut.mutate({ id: modal.editing.id, data: form });
    else createMut.mutate(form);
  };

  const set = (k: keyof Vessel, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Fleet Management</h1>
          <p className="text-slate-500 text-sm mt-1">{vessels.length} vessel{vessels.length !== 1 ? 's' : ''} registered</p>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <Plus className="w-4 h-4" /> Add Vessel
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : vessels.length === 0 ? (
        <div className="card p-12 text-center">
          <Ship className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">No vessels registered. Add your first vessel.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {vessels.map(vessel => (
            <div key={vessel.id} className="card p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-50 p-2 rounded-lg">
                    <Ship className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">{vessel.name}</h3>
                    <p className="text-xs text-slate-400">{vessel.imo_number ? `IMO: ${vessel.imo_number}` : 'No IMO'}</p>
                  </div>
                </div>
                <span className={`badge ${STATUS_COLORS[vessel.status] || 'bg-slate-100 text-slate-600'}`}>
                  {STATUS_LABELS[vessel.status] || vessel.status}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm mb-4">
                <div>
                  <p className="text-slate-400 text-xs">Type</p>
                  <p className="font-medium text-slate-700">{vessel.vessel_type || '—'}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Flag</p>
                  <p className="font-medium text-slate-700">{vessel.flag || '—'}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">DWT</p>
                  <p className="font-medium text-slate-700">{formatNumber(vessel.dead_weight)} MT</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Built</p>
                  <p className="font-medium text-slate-700">{vessel.year_built || '—'}</p>
                </div>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <div className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{vessel.total_voyages || 0}</span> voyages total
                  {(vessel.active_voyages || 0) > 0 && (
                    <span className="ml-2 text-blue-600 font-medium">({vessel.active_voyages} active)</span>
                  )}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(vessel)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => setDeleteConfirm(vessel.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form Modal */}
      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.editing ? 'Edit Vessel' : 'Add New Vessel'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Vessel Name *</label>
              <input className="input" value={form.name || ''} onChange={e => set('name', e.target.value)} required placeholder="MV Example" />
            </div>
            <div>
              <label className="label">IMO Number</label>
              <input className="input" value={form.imo_number || ''} onChange={e => set('imo_number', e.target.value)} placeholder="9123456" />
            </div>
            <div>
              <label className="label">Vessel Type</label>
              <select className="select" value={form.vessel_type || ''} onChange={e => set('vessel_type', e.target.value)}>
                <option value="">Select type</option>
                {VESSEL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Flag State</label>
              <select className="select" value={form.flag || ''} onChange={e => set('flag', e.target.value)}>
                <option value="">Select flag</option>
                {FLAGS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select className="select" value={form.status || 'active'} onChange={e => set('status', e.target.value)}>
                <option value="active">Active</option>
                <option value="maintenance">Maintenance</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div>
              <label className="label">Gross Tonnage (GT)</label>
              <input className="input" type="number" value={form.gross_tonnage || ''} onChange={e => set('gross_tonnage', +e.target.value)} placeholder="25000" />
            </div>
            <div>
              <label className="label">Dead Weight (MT)</label>
              <input className="input" type="number" value={form.dead_weight || ''} onChange={e => set('dead_weight', +e.target.value)} placeholder="43000" />
            </div>
            <div>
              <label className="label">Year Built</label>
              <input className="input" type="number" value={form.year_built || ''} onChange={e => set('year_built', +e.target.value)} placeholder="2015" min="1900" max={new Date().getFullYear()} />
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModal({ open: false })}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={createMut.isPending || updateMut.isPending}>
              {modal.editing ? 'Update Vessel' : 'Create Vessel'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal open={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} title="Delete Vessel" size="sm">
        <p className="text-slate-600 mb-4">Are you sure you want to delete this vessel? This action cannot be undone.</p>
        <div className="flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
          <button className="btn-danger" onClick={() => deleteConfirm && deleteMut.mutate(deleteConfirm)} disabled={deleteMut.isPending}>
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}
