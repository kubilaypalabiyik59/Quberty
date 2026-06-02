'use client';

import { useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';
import { ShieldCheck } from 'lucide-react';

export default function SettingsPage() {
  const { user, loadUser } = useAuthStore();
  const [promoting, setPromoting] = useState(false);
  const [promoteMsg, setPromoteMsg] = useState('');

  async function handleMakeAdmin() {
    if (!confirm('Promote your account to admin? This only works if you are the sole user in this tenant.')) return;
    setPromoting(true);
    setPromoteMsg('');
    try {
      await api.post('/auth/make-admin');
      setPromoteMsg('Done! Logging you out so the new role takes effect...');
      setTimeout(() => { window.location.href = '/login'; }, 2000);
    } catch (e: any) {
      setPromoteMsg(e.response?.data?.error?.message ?? e.message ?? 'Failed');
    } finally {
      setPromoting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500">System configuration</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-lg">
        <h2 className="text-lg font-semibold mb-4">Your Profile</h2>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between py-2 border-b border-gray-200">
            <span className="text-gray-500">Name</span>
            <span className="font-medium">{user?.first_name} {user?.last_name}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-200">
            <span className="text-gray-500">Email</span>
            <span className="font-medium">{user?.email}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-gray-500">Role</span>
            <span className="font-medium capitalize">{user?.role}</span>
          </div>
        </div>
      </div>

      {user?.role !== 'admin' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 max-w-lg">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-amber-800 text-sm">Admin Access Required</p>
              <p className="text-amber-700 text-xs mt-1 leading-relaxed">
                Your account has role <strong>{user?.role}</strong>. To create cashier/employee accounts via HR,
                you need admin role. If you are the only user in this system, you can self-promote below.
              </p>
              {promoteMsg && (
                <p className="text-xs mt-2 font-medium text-amber-800">{promoteMsg}</p>
              )}
              <button
                onClick={handleMakeAdmin}
                disabled={promoting}
                className="mt-3 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                {promoting ? 'Promoting...' : 'Make My Account Admin'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
