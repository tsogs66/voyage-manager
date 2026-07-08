import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
});

export interface Vessel {
  id: number;
  name: string;
  imo_number?: string;
  vessel_type?: string;
  flag?: string;
  gross_tonnage?: number;
  dead_weight?: number;
  year_built?: number;
  status: string;
  total_voyages?: number;
  active_voyages?: number;
  created_at: string;
}

export interface Port {
  id: number;
  name: string;
  country?: string;
  un_locode?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
}

export interface Voyage {
  id: number;
  voyage_number: string;
  vessel_id: number;
  vessel_name?: string;
  vessel_type?: string;
  flag?: string;
  port_of_departure_id?: number;
  port_of_arrival_id?: number;
  departure_port_name?: string;
  arrival_port_name?: string;
  departure_country?: string;
  arrival_country?: string;
  departure_date?: string;
  arrival_date?: string;
  status: string;
  cargo_type?: string;
  cargo_quantity?: number;
  cargo_unit?: string;
  freight_rate?: number;
  total_freight?: number;
  fuel_consumption?: number;
  distance_nm?: number;
  notes?: string;
  total_expenses?: number;
  expenses?: Expense[];
  created_at: string;
}

export interface Expense {
  id: number;
  voyage_id: number;
  category: string;
  description?: string;
  amount: number;
  currency: string;
  expense_date?: string;
}

export interface Stats {
  total: number;
  byStatus: { status: string; count: number }[];
  totalFreight: number;
  totalExpenses: number;
  netRevenue: number;
  avgDistance: number;
  monthlyFreight: { month: string; freight: number; expenses: number; count: number }[];
  topVessels: { name: string; voyages: number; total_freight: number }[];
}

export const vesselApi = {
  list: () => api.get<Vessel[]>('/vessels').then(r => r.data),
  get: (id: number) => api.get<Vessel>(`/vessels/${id}`).then(r => r.data),
  create: (data: Partial<Vessel>) => api.post<Vessel>('/vessels', data).then(r => r.data),
  update: (id: number, data: Partial<Vessel>) => api.put<Vessel>(`/vessels/${id}`, data).then(r => r.data),
  delete: (id: number) => api.delete(`/vessels/${id}`).then(r => r.data),
};

export const portApi = {
  list: () => api.get<Port[]>('/ports').then(r => r.data),
  get: (id: number) => api.get<Port>(`/ports/${id}`).then(r => r.data),
  create: (data: Partial<Port>) => api.post<Port>('/ports', data).then(r => r.data),
  update: (id: number, data: Partial<Port>) => api.put<Port>(`/ports/${id}`, data).then(r => r.data),
  delete: (id: number) => api.delete(`/ports/${id}`).then(r => r.data),
};

export const voyageApi = {
  list: (params?: Record<string, string>) => api.get<Voyage[]>('/voyages', { params }).then(r => r.data),
  get: (id: number) => api.get<Voyage>(`/voyages/${id}`).then(r => r.data),
  stats: () => api.get<Stats>('/voyages/stats').then(r => r.data),
  create: (data: Partial<Voyage>) => api.post<Voyage>('/voyages', data).then(r => r.data),
  update: (id: number, data: Partial<Voyage>) => api.put<Voyage>(`/voyages/${id}`, data).then(r => r.data),
  delete: (id: number) => api.delete(`/voyages/${id}`).then(r => r.data),
  addExpense: (id: number, data: Partial<Expense>) => api.post<Expense>(`/voyages/${id}/expenses`, data).then(r => r.data),
  deleteExpense: (voyageId: number, expId: number) => api.delete(`/voyages/${voyageId}/expenses/${expId}`).then(r => r.data),
  exportUrl: () => `${api.defaults.baseURL}/voyages/export`,
};

export default api;
