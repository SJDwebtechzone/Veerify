import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Navbar } from './Navbar';

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 gradient-bg">
      <div className="flex">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        <div className="flex-1 min-w-0">
          <Navbar onMenuClick={() => setSidebarOpen(true)} />
          <main className="px-4 lg:px-8 py-6 lg:py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
