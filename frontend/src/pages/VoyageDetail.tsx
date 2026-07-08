import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { voyageApi, type Expense } from '../api';
import { ArrowLeft, Plus, Trash2, DollarSign, Ship, MapPin, Package, FileText } from 'lucide-react';
import { formatCurrency, formatDate, formatNumber, STATUS_COLORS, STATUS_LABELS } from '../utils';
import toast from 'react-hot-toast';

const EXPENSE_CATEGORIES = ['Fuel', 'Port Charges', 'Crew', 'Maintenance', 'Insurance', 'Agency Fees', 'Canal Dues', 'Pilotage', 'Other'];

interface Props {
  voyageId: number;
  onBack: () => void;
}

export default function VoyageDetail({ voyageId, onBack }: Props) {
  const qc = useQueryClient();
  const [expForm, setExpForm] = useState({ category: '', description: '', amount: '', currency: 'USD', expense_date: '' });
  const [showExpForm, setShowExpForm] = useState(false);

  const { data: voyage, isLoading } = useQuery({
    queryKey: ['voyage', voyageId],
    queryFn: () => voyageApi.get(voyageId),
  });

  const addExpMut = useMutation({
    mutationFn: (data: Partial<Expense>) => voyageApi.addExpense(voyageId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['voyage', voyageId] });
      qc.invalidateQueries({ queryKey: ['voyages'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      toast.success('Expense added');
      setExpForm({ category: '', description: '', amount: '', currency: 'USD', expense_date: '' });
      setShowExpForm(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Error'),
  });

  const delExpMut = useMutation({
    mutationFn: (expId: number) => voyageApi.deleteExpense(voyageId, expId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['voyage', voyageId] });
      qc.invalidateQueries({ queryKey: ['voyages'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      toast.success('Expense removed');
    },
  });

  const handleAddExp = (e: React.FormEvent) => {
    e.preventDefault();
    addExpMut.mutate({ ...expForm, amount: +expForm.amount });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (!voyage) return <div className="text-red-500">Voyage not found</div>;

  const netRevenue = (voyage.total_freight || 0) - (voyage.total_expenses || 0);
  const expenses = voyage.expenses || [];

  const expenseByCategory = expenses.reduce((acc: Record<string, number>, e) => {
    acc[e.category] = (acc[e.category] || 0) + e.amount;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="btn-secondary">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900 font-mono">{voyage.voyage_number}</h1>
            <span className={`badge text-sm ${STATUS_COLORS[voyage.status]}`}>{STATUS_LABELS[voyage.status]}</span>
          </div>
          <p className="text-slate-500 text-sm">{voyage.vessel_name} • {voyage.vessel_type}</p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card p-4 text-center">
          <p className="text-xs text-slate-400 mb-1">Total Freight</p>
          <p className="text-xl font-bold text-emerald-700">{formatCurrency(voyage.total_freight)}</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs text-slate-400 mb-1">Total Expenses</p>
          <p className="text-xl font-bold text-red-600">{formatCurrency(voyage.total_expenses)}</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs text-slate-400 mb-1">Net Revenue</p>
          <p className={`text-xl font-bold ${netRevenue >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatCurrency(netRevenue)}</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs text-slate-400 mb-1">Distance</p>
          <p className="text-xl font-bold text-blue-700">{formatNumber(voyage.distance_nm)} NM</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Voyage Info */}
        <div className="lg:col-span-1 space-y-4">
          {/* Route */}
          <div className="card p-5">
            <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-slate-400" /> Route
            </h3>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-slate-400">Departure</p>
                <p className="font-semibold text-slate-900">{voyage.departure_port_name || '—'}</p>
                <p className="text-xs text-slate-500">{formatDate(voyage.departure_date)}</p>
              </div>
              <div className="flex items-center gap-2 text-slate-300">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs">→</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>
              <div>
                <p className="text-xs text-slate-400">Arrival</p>
                <p className="font-semibold text-slate-900">{voyage.arrival_port_name || '—'}</p>
                <p className="text-xs text-slate-500">{formatDate(voyage.arrival_date)}</p>
              </div>
            </div>
          </div>

          {/* Vessel */}
          <div className="card p-5">
            <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Ship className="w-4 h-4 text-slate-400" /> Vessel
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Name</span>
                <span className="font-medium text-slate-900">{voyage.vessel_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Type</span>
                <span className="font-medium text-slate-900">{voyage.vessel_type || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Flag</span>
                <span className="font-medium text-slate-900">{voyage.flag || '—'}</span>
              </div>
            </div>
          </div>

          {/* Cargo */}
          <div className="card p-5">
            <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Package className="w-4 h-4 text-slate-400" /> Cargo & Freight
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Cargo Type</span>
                <span className="font-medium text-slate-900">{voyage.cargo_type || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Quantity</span>
                <span className="font-medium text-slate-900">{voyage.cargo_quantity ? `${formatNumber(voyage.cargo_quantity)} ${voyage.cargo_unit}` : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Freight Rate</span>
                <span className="font-medium text-slate-900">{voyage.freight_rate ? `$${voyage.freight_rate}/${voyage.cargo_unit}` : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Fuel (MT)</span>
                <span className="font-medium text-slate-900">{formatNumber(voyage.fuel_consumption)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {voyage.notes && (
            <div className="card p-5">
              <h3 className="font-semibold text-slate-900 mb-2 flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-400" /> Notes
              </h3>
              <p className="text-sm text-slate-600">{voyage.notes}</p>
            </div>
          )}
        </div>

        {/* Right: Expenses */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-slate-400" /> Expenses
              </h3>
              <button className="btn-primary text-xs py-1.5" onClick={() => setShowExpForm(v => !v)}>
                <Plus className="w-3.5 h-3.5" /> Add Expense
              </button>
            </div>

            {showExpForm && (
              <form onSubmit={handleAddExp} className="bg-slate-50 rounded-xl p-4 mb-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label text-xs">Category *</label>
                    <select className="select text-sm" value={expForm.category} onChange={e => setExpForm(f => ({ ...f, category: e.target.value }))} required>
                      <option value="">Select</option>
                      {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label text-xs">Amount (USD) *</label>
                    <input className="input text-sm" type="number" step="0.01" value={expForm.amount} onChange={e => setExpForm(f => ({ ...f, amount: e.target.value }))} required placeholder="10000" />
                  </div>
                  <div>
                    <label className="label text-xs">Description</label>
                    <input className="input text-sm" value={expForm.description} onChange={e => setExpForm(f => ({ ...f, description: e.target.value }))} placeholder="Bunker fuel HFO" />
                  </div>
                  <div>
                    <label className="label text-xs">Date</label>
                    <input className="input text-sm" type="date" value={expForm.expense_date} onChange={e => setExpForm(f => ({ ...f, expense_date: e.target.value }))} />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button type="button" className="btn-secondary text-xs py-1.5" onClick={() => setShowExpForm(false)}>Cancel</button>
                  <button type="submit" className="btn-primary text-xs py-1.5" disabled={addExpMut.isPending}>Add Expense</button>
                </div>
              </form>
            )}

            {/* Expense summary by category */}
            {Object.keys(expenseByCategory).length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                {Object.entries(expenseByCategory).map(([cat, total]) => (
                  <div key={cat} className="bg-slate-50 rounded-lg px-3 py-2">
                    <p className="text-xs text-slate-500">{cat}</p>
                    <p className="text-sm font-semibold text-slate-900">{formatCurrency(total)}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="divide-y divide-slate-100">
              {expenses.length === 0 ? (
                <p className="text-center py-6 text-slate-400 text-sm">No expenses recorded</p>
              ) : expenses.map((exp) => (
                <div key={exp.id} className="flex items-center justify-between py-2.5">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900">{exp.category}</span>
                      {exp.description && <span className="text-xs text-slate-400">— {exp.description}</span>}
                    </div>
                    {exp.expense_date && <p className="text-xs text-slate-400">{formatDate(exp.expense_date)}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-red-600">{formatCurrency(exp.amount)}</span>
                    <button onClick={() => delExpMut.mutate(exp.id)} className="p-1 text-slate-300 hover:text-red-500 transition-colors rounded">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {expenses.length > 0 && (
              <div className="border-t border-slate-200 pt-3 mt-2 flex justify-between items-center">
                <span className="text-sm font-semibold text-slate-700">Total Expenses</span>
                <span className="text-lg font-bold text-red-600">{formatCurrency(voyage.total_expenses)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
