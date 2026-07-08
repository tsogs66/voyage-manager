import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { voyageApi, vesselApi, portApi, type Voyage } from '../api';
import Modal from '../components/Modal';
import VoyageDetail from './VoyageDetail';
import { Plus, Pencil, Trash2, Eye, Search, Filter, Download, Waves } from 'lucide-react';
import { formatCurrency, formatDate, formatNumber, STATUS_COLORS, STATUS_LABELS } from '../utils';
import toast from 'react-hot-toast';

const CARGO_TYPES = ['Iron Ore', 'Coal', 'Crude Oil', 'LNG', 'LPG', 'Containers', 'General Cargo', 'Steel', 'Grain', 'Chemicals', 'Cement', 'Electronics', 'Other'];

const emptyVoyage: Partial<Voyage> = {
  voyage_number: '', vessel_id: undefined, status: 'planned',
  cargo_unit: 'MT', departure_date: '', arrival_date: '',
};

export default function Voyages() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; editing?: Voyage }>({ open: false });
  const [detailId, setDetailId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<Voyage>>(emptyVoyage);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data: voyages = [], isLoading } = useQuery({
    queryKey: ['voyages', search, statusFilter],
    queryFn: () => voyageApi.list({
      ...(search && { search }),
      ...(statusFilter && { status: statusFilter }),
    }),
  });

  const { data: vessels = [] } = useQuery({ queryKey: ['vessels'], queryFn: vesselApi.list });
  const { data: ports = [] } = useQuery({ queryKey: ['ports'], queryFn: portApi.list });

  const createMut = useMutation({
    mutationFn: voyageApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['voyages'] }); qc.invalidateQueries({ queryKey: ['stats'] }); toast.success('Voyage created'); setModal({ open: false }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Error creating voyage'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Voyage> }) => voyageApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['voyages'] }); qc.invalidateQueries({ queryKey: ['stats'] }); toast.success('Voyage updated'); setModal({ open: false }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Error'),
  });

  const deleteMut = useMutation({
    mutationFn: voyageApi.delete,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['voyages'] }); qc.invalidateQueries({ queryKey: ['stats'] }); toast.success('Voyage deleted'); setDeleteConfirm(null); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Error'),
  });

  const openCreate = () => {
    const nextNum = `V-${new Date().getFullYear()}-${String(voyages.length + 1).padStart(3, '0')}`;
    setForm({ ...emptyVoyage, voyage_number: nextNum });
    setModal({ open: true });
  };

  const openEdit = (v: Voyage) => {
    setForm({ ...v });
    setModal({ open: true, editing: v });
  };

  const set = (k: keyof Voyage, v: string | number | undefined) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      ...form,
      total_freight: form.freight_rate && form.cargo_quantity
        ? form.freight_rate * form.cargo_quantity
        : form.total_freight,
    };
    if (modal.editing) updateMut.mutate({ id: modal.editing.id, data });
    else createMut.mutate(data);
  };

  if (detailId !== null) {
    return <VoyageDetail voyageId={detailId} onBack={() => setDetailId(null)} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Voyage Management</h1>
          <p className="text-slate-500 text-sm mt-1">{voyages.length} voyage{voyages.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          <a href={voyageApi.exportUrl()} download className="btn-secondary">
            <Download className="w-4 h-4" /> Excel
          </a>
          <button className="btn-primary" onClick={openCreate}>
            <Plus className="w-4 h-4" /> New Voyage
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="input pl-10" placeholder="Search voyage #, vessel, port..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <select className="select pl-10 pr-4 min-w-[160px]" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="planned">Planned</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="table-header">Voyage #</th>
                  <th className="table-header">Vessel</th>
                  <th className="table-header">Route</th>
                  <th className="table-header">Dates</th>
                  <th className="table-header">Cargo</th>
                  <th className="table-header">Freight</th>
                  <th className="table-header">Status</th>
                  <th className="table-header text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {voyages.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-slate-400">
                      <Waves className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                      No voyages found
                    </td>
                  </tr>
                ) : voyages.map(voyage => (
                  <tr key={voyage.id} className="hover:bg-slate-50 transition-colors">
                    <td className="table-cell">
                      <span className="font-mono font-semibold text-blue-700">{voyage.voyage_number}</span>
                    </td>
                    <td className="table-cell">
                      <div>
                        <p className="font-medium text-slate-900">{voyage.vessel_name || '—'}</p>
                        <p className="text-xs text-slate-400">{voyage.vessel_type || ''}</p>
                      </div>
                    </td>
                    <td className="table-cell">
                      <div className="text-sm">
                        <p className="text-slate-700">{voyage.departure_port_name || '—'}</p>
                        <p className="text-slate-400 text-xs">→ {voyage.arrival_port_name || '—'}</p>
                      </div>
                    </td>
                    <td className="table-cell text-sm text-slate-600">
                      <p>{formatDate(voyage.departure_date)}</p>
                      <p className="text-xs text-slate-400">{formatDate(voyage.arrival_date)}</p>
                    </td>
                    <td className="table-cell">
                      <p className="text-sm text-slate-700">{voyage.cargo_type || '—'}</p>
                      {voyage.cargo_quantity && (
                        <p className="text-xs text-slate-400">{formatNumber(voyage.cargo_quantity)} {voyage.cargo_unit}</p>
                      )}
                    </td>
                    <td className="table-cell">
                      <p className="font-semibold text-emerald-700">{formatCurrency(voyage.total_freight)}</p>
                      {(voyage.total_expenses ?? 0) > 0 && (
                        <p className="text-xs text-red-500">-{formatCurrency(voyage.total_expenses)}</p>
                      )}
                    </td>
                    <td className="table-cell">
                      <span className={`badge ${STATUS_COLORS[voyage.status] || 'bg-slate-100 text-slate-600'}`}>
                        {STATUS_LABELS[voyage.status] || voyage.status}
                      </span>
                    </td>
                    <td className="table-cell text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setDetailId(voyage.id)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="View details">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={() => openEdit(voyage)} className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title="Edit">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => setDeleteConfirm(voyage.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Voyage Form Modal */}
      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.editing ? 'Edit Voyage' : 'New Voyage'} size="xl">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Voyage Number *</label>
              <input className="input font-mono" value={form.voyage_number || ''} onChange={e => set('voyage_number', e.target.value)} required placeholder="V-2026-001" />
            </div>
            <div>
              <label className="label">Vessel *</label>
              <select className="select" value={form.vessel_id || ''} onChange={e => set('vessel_id', +e.target.value)} required>
                <option value="">Select vessel</option>
                {vessels.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Port of Departure</label>
              <select className="select" value={form.port_of_departure_id || ''} onChange={e => set('port_of_departure_id', +e.target.value)}>
                <option value="">Select port</option>
                {ports.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Port of Arrival</label>
              <select className="select" value={form.port_of_arrival_id || ''} onChange={e => set('port_of_arrival_id', +e.target.value)}>
                <option value="">Select port</option>
                {ports.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Departure Date</label>
              <input className="input" type="date" value={form.departure_date || ''} onChange={e => set('departure_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Arrival Date</label>
              <input className="input" type="date" value={form.arrival_date || ''} onChange={e => set('arrival_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="select" value={form.status || 'planned'} onChange={e => set('status', e.target.value)}>
                <option value="planned">Planned</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div>
              <label className="label">Distance (NM)</label>
              <input className="input" type="number" value={form.distance_nm || ''} onChange={e => set('distance_nm', +e.target.value)} placeholder="8500" />
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Cargo & Freight</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Cargo Type</label>
                <select className="select" value={form.cargo_type || ''} onChange={e => set('cargo_type', e.target.value)}>
                  <option value="">Select cargo type</option>
                  {CARGO_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Cargo Unit</label>
                <select className="select" value={form.cargo_unit || 'MT'} onChange={e => set('cargo_unit', e.target.value)}>
                  <option value="MT">MT (Metric Ton)</option>
                  <option value="TEU">TEU</option>
                  <option value="BBL">BBL (Barrels)</option>
                  <option value="CBM">CBM</option>
                </select>
              </div>
              <div>
                <label className="label">Cargo Quantity</label>
                <input className="input" type="number" value={form.cargo_quantity || ''} onChange={e => set('cargo_quantity', +e.target.value)} placeholder="40000" />
              </div>
              <div>
                <label className="label">Freight Rate (USD/{form.cargo_unit || 'MT'})</label>
                <input className="input" type="number" step="0.01" value={form.freight_rate || ''} onChange={e => set('freight_rate', +e.target.value)} placeholder="12.50" />
              </div>
              <div>
                <label className="label">Total Freight (USD)</label>
                <input className="input" type="number" value={
                  form.freight_rate && form.cargo_quantity
                    ? Math.round(form.freight_rate * form.cargo_quantity)
                    : form.total_freight || ''
                } onChange={e => set('total_freight', +e.target.value)} placeholder="500000" />
              </div>
              <div>
                <label className="label">Fuel Consumption (MT)</label>
                <input className="input" type="number" value={form.fuel_consumption || ''} onChange={e => set('fuel_consumption', +e.target.value)} placeholder="180" />
              </div>
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input resize-none" rows={2} value={form.notes || ''} onChange={e => set('notes', e.target.value)} placeholder="Any additional notes..." />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModal({ open: false })}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={createMut.isPending || updateMut.isPending}>
              {modal.editing ? 'Update Voyage' : 'Create Voyage'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal open={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} title="Delete Voyage" size="sm">
        <p className="text-slate-600 mb-4">Are you sure you want to delete this voyage? All associated expenses will also be deleted.</p>
        <div className="flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
          <button className="btn-danger" onClick={() => deleteConfirm && deleteMut.mutate(deleteConfirm)} disabled={deleteMut.isPending}>Delete</button>
        </div>
      </Modal>
    </div>
  );
}
