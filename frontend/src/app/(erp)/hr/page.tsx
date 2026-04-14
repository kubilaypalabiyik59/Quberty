'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus, X, Users, Mail, Briefcase } from 'lucide-react';

const ROLES = ['employee', 'warehouse_worker', 'store_manager', 'admin'];

const emptyForm = {
  first_name: '', last_name: '', email: '', password: '',
  role: 'employee', department: '', position: '',
};

export default function HRPage() {
  const qc = useQueryClient();

  const [showModal, setShowModal] = useState(false);
  const [form, setForm]           = useState({ ...emptyForm });
  const [formError, setFormError] = useState('');

  const { data: employees, isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => api.get('/hr/employees').then(r => r.data.data),
  });

  const create = useMutation({
    mutationFn: () => api.post('/hr/employees', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      setShowModal(false);
      setForm({ ...emptyForm });
      setFormError('');
    },
    onError: (err: any) => setFormError(err.response?.data?.error?.message ?? err.response?.data?.message ?? 'Failed to create employee'),
  });

  const field = (key: keyof typeof form, label: string, type = 'text', required = false) => (
    <div key={key}>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <input
        type={type}
        required={required}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        value={form[key]}
        onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Human Resources</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage employees and system accounts</p>
        </div>
        <button
          onClick={() => { setShowModal(true); setFormError(''); setForm({ ...emptyForm }); }}
          className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="h-4 w-4" /> New Employee
        </button>
      </div>

      {/* Employee table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Employee</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Code</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Department / Position</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && Array.from({ length: 3 }).map((_, i) => (
              <tr key={i}>
                {Array.from({ length: 5 }).map((_, j) => (
                  <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                ))}
              </tr>
            ))}
            {!isLoading && (employees ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-16 text-center text-gray-400">
                  <Users className="h-10 w-10 mx-auto mb-2 text-gray-200" />
                  <p className="text-sm">No employees yet. Click "New Employee" to add one.</p>
                </td>
              </tr>
            )}
            {(employees ?? []).map((emp: any) => (
              <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">
                    {emp.user?.first_name ?? ''} {emp.user?.last_name ?? emp.employee_code}
                  </div>
                  {emp.user?.email && <div className="text-xs text-gray-400">{emp.user.email}</div>}
                </td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{emp.employee_code}</td>
                <td className="px-4 py-3">
                  <div className="text-gray-700">{emp.position ?? '—'}</div>
                  {emp.department && <div className="text-xs text-gray-400">{emp.department}</div>}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 capitalize">
                    {emp.user?.role ?? '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${emp.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {emp.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── New Employee Modal ──────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">New Employee</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={e => { e.preventDefault(); create.mutate(); }} className="p-6 space-y-4">

              {/* Employee info */}
              <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <Briefcase className="h-3.5 w-3.5" /> Employee Info
              </div>
              <div className="grid grid-cols-2 gap-3">
                {field('first_name', 'First Name', 'text', true)}
                {field('last_name', 'Last Name', 'text', true)}
              </div>
              {field('department', 'Department')}
              {field('position', 'Position')}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.role}
                  onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                >
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {/* System account */}
              <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wider pt-2">
                <Mail className="h-3.5 w-3.5" /> System Account (ERP + POS)
              </div>
              <p className="text-xs text-gray-400 -mt-2">
                Creates a login for the web ERP and the POS cashier app. Required for cashiers.
              </p>
              {field('email', 'Email', 'email')}
              {field('password', 'Password', 'password')}

              {formError && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{formError}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={create.isPending}
                  className="flex-1 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  {create.isPending ? 'Creating...' : 'Create Employee'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
