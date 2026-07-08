import { useQuery } from '@tanstack/react-query';
import { voyageApi } from '../api';
import StatCard from '../components/StatCard';
import { Waves, DollarSign, TrendingUp, Navigation, Ship, Download } from 'lucide-react';
import { formatCurrency, formatNumber, STATUS_COLORS, STATUS_LABELS } from '../utils';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend,
} from 'recharts';

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: voyageApi.stats,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  const statusMap = Object.fromEntries((stats?.byStatus || []).map(s => [s.status, s.count]));

  const chartData = (stats?.monthlyFreight || []).map(m => ({
    month: m.month,
    Revenue: Math.round((m.freight || 0) / 1000),
    Expenses: Math.round((m.expenses || 0) / 1000),
    Profit: Math.round(((m.freight || 0) - (m.expenses || 0)) / 1000),
    Voyages: m.count,
  }));

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Operations Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">Real-time overview of voyage operations</p>
        </div>
        <a
          href={voyageApi.exportUrl()}
          download="voyage-report.xlsx"
          className="btn-success"
        >
          <Download className="w-4 h-4" />
          Export to Excel
        </a>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Voyages"
          value={formatNumber(stats?.total)}
          subtitle={`${statusMap.in_progress || 0} in progress`}
          icon={Waves}
          color="blue"
        />
        <StatCard
          title="Total Freight"
          value={formatCurrency(stats?.totalFreight)}
          subtitle="All time revenue"
          icon={DollarSign}
          color="emerald"
        />
        <StatCard
          title="Net Revenue"
          value={formatCurrency(stats?.netRevenue)}
          subtitle={`Expenses: ${formatCurrency(stats?.totalExpenses)}`}
          icon={TrendingUp}
          color="purple"
        />
        <StatCard
          title="Avg Distance"
          value={`${formatNumber(stats?.avgDistance)} NM`}
          subtitle="Per voyage"
          icon={Navigation}
          color="amber"
        />
      </div>

      {/* Status breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {['planned', 'in_progress', 'completed', 'cancelled'].map(s => (
          <div key={s} className="card p-4 text-center">
            <p className="text-2xl font-bold text-slate-900">{statusMap[s] || 0}</p>
            <span className={`badge mt-1 ${STATUS_COLORS[s]}`}>{STATUS_LABELS[s]}</span>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue chart */}
        <div className="card p-6 lg:col-span-2">
          <h3 className="font-semibold text-slate-900 mb-4">Monthly P&L (USD thousands)</h3>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => [`$${v}K`, '']} />
                <Legend />
                <Area type="monotone" dataKey="Revenue" stroke="#3b82f6" fill="url(#colorRevenue)" strokeWidth={2} />
                <Area type="monotone" dataKey="Profit" stroke="#10b981" fill="url(#colorProfit)" strokeWidth={2} />
                <Area type="monotone" dataKey="Expenses" stroke="#f59e0b" fill="none" strokeWidth={2} strokeDasharray="4 2" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-48 text-slate-400 text-sm">No data yet</div>
          )}
        </div>

        {/* Top vessels */}
        <div className="card p-6">
          <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Ship className="w-4 h-4 text-slate-400" /> Top Vessels
          </h3>
          {(stats?.topVessels || []).length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={stats?.topVessels} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `$${Math.round(v / 1000)}K`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                <Tooltip formatter={(v) => [formatCurrency(Number(v)), 'Total Freight']} />
                <Bar dataKey="total_freight" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-48 text-slate-400 text-sm">No data yet</div>
          )}
        </div>
      </div>
    </div>
  );
}
