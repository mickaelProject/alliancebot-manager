import React from 'react';
import { WeeklyPlanner } from './WeeklyPlanner.jsx';
import { AdminScreen } from './AdminScreen.jsx';

export function App() {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  if (path === '/admin' || path.startsWith('/admin/')) {
    return <AdminScreen />;
  }
  return <WeeklyPlanner />;
}
