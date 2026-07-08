import { NavLink, Outlet } from 'react-router-dom';
import { Anchor, Ship, MapPin, BarChart3, Waves } from 'lucide-react';

const navItems = [
  { to: '/', label: 'Dashboard', icon: BarChart3 },
  { to: '/voyages', label: 'Voyages', icon: Waves },
  { to: '/vessels', label: 'Vessels', icon: Ship },
  { to: '/ports', label: 'Ports', icon: MapPin },
];

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Top nav */}
      <header className="bg-slate-900 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="bg-blue-500 p-1.5 rounded-lg">
                <Anchor className="w-6 h-6 text-white" />
              </div>
              <div>
                <span className="font-bold text-lg tracking-tight">VoyageManager</span>
                <span className="ml-2 text-slate-400 text-xs hidden sm:inline">Maritime Operations</span>
              </div>
            </div>
            <nav className="flex items-center gap-1">
              {navItems.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`
                  }
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{label}</span>
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      <footer className="bg-white border-t border-slate-200 py-4 text-center text-sm text-slate-400">
        VoyageManager © {new Date().getFullYear()} — Maritime Operations System
      </footer>
    </div>
  );
}
