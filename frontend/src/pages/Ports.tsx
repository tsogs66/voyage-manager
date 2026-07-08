import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { portApi, type Port } from '../api';
import Modal from '../components/Modal';
import { Plus, Pencil, Trash2, MapPin, Search } from 'lucide-react';
import toast from 'react-hot-toast';

const empty: Partial<Port> = { name: '', country: '', un_locode: '', timezone: '' };

export default function Ports() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; editing?: Port }>({ open: false });
  const [form, setForm] = useState<Partial<Port>>(empty);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const { data: ports = [], isLoading } = useQuery({ queryKey: ['ports'], queryFn: portApi.list });

  const filtered = ports.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.country || '').toLowerCase().includes(search.toLowerCase()) || (p.un_locode || '').toLowerCase().includes(search.toLowerCase())
  );

  const createMut = useMutation({
    mutationFn: portApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ports'] }); toast.success('Port added'); setModal({ open: false }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Error'),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Port> }) => portApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ports'] }); toast.success('Port updated'); setModal({ open: false }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Error'),
  });
  const deleteMut = useMutation({
    mutationFn: portApi.delete,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ports'] }); toast.success('Port deleted'); setDeleteConfirm(null); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Error'),
  });

  const openCreate = () => { setForm(empty); setModal({ open: true }); };
  const openEdit = (p: Port) => { setForm({ ...p }); setModal({ open: true, editing: p }); };
  const set = (k: keyof Port, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (modal.editing) updateMut.mutate({ id: modal.editing.id, data: form });
    else createMut.mutate(form);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Port Directory</h1>
          <p className="text-slate-500 text-sm mt-1">{ports.length} port{ports.length !== 1 ? 's' : ''} registered</p>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <Plus className="w-4 h-4" /> Add Port
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          className="input pl-10"
          placeholder="Search by name, country or UN/LOCODE..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="table-header">Port Name</th>
                <th className="table-header">Country</th>
                <th className="table-header">UN/LOCODE</th>
                <th className="table-header hidden md:table-cell">Coordinates</th>
                <th className="table-header hidden lg:table-cell">Timezone</th>
                <th className="table-header text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-400">
                    <MapPin className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    {search ? 'No ports match your search' : 'No ports registered'}
                  </td>
                </tr>
              ) : filtered.map(port => (
                <tr key={port.id} className="hover:bg-slate-50 transition-colors">
                  <td className="table-cell">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      <span className="font-medium text-slate-900">{port.name}</span>
                    </div>
                  </td>
                  <td className="table-cell text-slate-600">{port.country || '—'}</td>
                  <td className="table-cell">
                    {port.un_locode ? (
                      <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">{port.un_locode}</span>
                    ) : '—'}
                  </td>
                  <td className="table-cell hidden md:table-cell text-slate-500 text-xs">
                    {port.latitude && port.longitude
                      ? `${port.latitude.toFixed(4)}, ${port.longitude.toFixed(4)}`
                      : '—'}
                  </td>
                  <td className="table-cell hidden lg:table-cell text-slate-500 text-xs">{port.timezone || '—'}</td>
                  <td className="table-cell text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEdit(port)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => setDeleteConfirm(port.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.editing ? 'Edit Port' : 'Add Port'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Port Name *</label>
              <input className="input" value={form.name || ''} onChange={e => set('name', e.target.value)} required placeholder="Port of Rotterdam" />
            </div>
            <div>
              <label className="label">Country</label>
              <input className="input" value={form.country || ''} onChange={e => set('country', e.target.value)} placeholder="Netherlands" />
            </div>
            <div>
              <label className="label">UN/LOCODE</label>
              <input className="input" value={form.un_locode || ''} onChange={e => set('un_locode', e.target.value.toUpperCase())} placeholder="NLRTM" maxLength={5} />
            </div>
            <div>
              <label className="label">Latitude</label>
              <input className="input" type="number" step="0.0001" value={form.latitude || ''} onChange={e => set('latitude', +e.target.value)} placeholder="51.9244" />
            </div>
            <div>
              <label className="label">Longitude</label>
              <input className="input" type="number" step="0.0001" value={form.longitude || ''} onChange={e => set('longitude', +e.target.value)} placeholder="4.4777" />
            </div>
            <div className="col-span-2">
              <label className="label">Timezone</label>
              <input className="input" value={form.timezone || ''} onChange={e => set('timezone', e.target.value)} placeholder="Europe/Amsterdam" />
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModal({ open: false })}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={createMut.isPending || updateMut.isPending}>
              {modal.editing ? 'Update Port' : 'Add Port'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} title="Delete Port" size="sm">
        <p className="text-slate-600 mb-4">Are you sure you want to delete this port?</p>
        <div className="flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
          <button className="btn-danger" onClick={() => deleteConfirm && deleteMut.mutate(deleteConfirm)} disabled={deleteMut.isPending}>Delete</button>
        </div>
      </Modal>
    </div>
  );
}
