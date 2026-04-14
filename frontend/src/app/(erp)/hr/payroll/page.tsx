'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { DollarSign, Play, ChevronDown, ChevronRight, AlertCircle, CheckCircle } from 'lucide-react';

const fmt = (n: number) =>
  n.toLocaleString('es-BO', { style: 'currency', currency: 'BOB', minimumFractionDigits: 2 });

export default function PayrollPage() {
  const qc = useQueryClient();
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [runError, setRunError]     = useState('');
  const [runSuccess, setRunSuccess] = useState('');
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  // Load employees
  const { data: employees = [] } = useQuery({
    queryKey: ['employees'],
    queryFn: () => api.get('/hr/employees').then((r) => r.data.data),
  });

  // Payroll lines state: keyed by employee id
  const [overrides, setOverrides] = useState<Record<string, { gross: string; deductions: string }>>({});

  const getLine = (emp: any) => ({
    gross:      overrides[emp.id]?.gross      ?? String(emp.salary ?? '0'),
    deductions: overrides[emp.id]?.deductions ?? '0',
  });

  const setLine = (empId: string, field: 'gross' | 'deductions', val: string) =>
    setOverrides((prev) => ({ ...prev, [empId]: { ...getLine({ id: empId }), [field]: val } }));

  // Load past runs
  const { data: runs = [] } = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: () => api.get('/hr/payroll').then((r) => r.data.data),
  });

  const runPayroll = useMutation({
    mutationFn: () => {
      const lines = employees.map((emp: any) => {
        const l = getLine(emp);
        return {
          employee_id:   emp.id,
          employee_name: emp.user ? `${emp.user.first_name} ${emp.user.last_name}`.trim() : emp.employee_code,
          gross_salary:  Number(l.gross),
          deductions:    Number(l.deductions),
        };
      });
      return api.post('/hr/payroll', { year, month, lines });
    },
    onSuccess: (res) => {
      const s = res.data.data.summary;
      setRunSuccess(`Payroll ${s.period} processed. ${s.employees} employees, total gross ${fmt(s.total_gross)}.`);
      setRunError('');
      qc.invalidateQueries({ queryKey: ['payroll-runs'] });
    },
    onError: (err: any) => {
      setRunError(err.response?.data?.error?.message ?? err.response?.data?.message ?? 'Failed to run payroll');
      setRunSuccess('');
    },
  });

  const MONTHS = Array.from({ length: 12 }, (_, i) =>
    new Date(2000, i).toLocaleString('es-BO', { month: 'long' })
  );

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <DollarSign className="w-6 h-6 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payroll</h1>
          <p className="text-sm text-gray-500 mt-0.5">Run monthly payroll — creates a journal entry (Dr 5201 / Cr 2201)</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Run payroll panel */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-5">
          <h2 className="font-semibold text-gray-800 mb-4">Run Payroll</h2>

          <div className="flex gap-4 mb-5">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Year</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-24"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Month</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm"
              >
                {MONTHS.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          {employees.length === 0 ? (
            <p className="text-sm text-gray-400 py-4">No active employees found.</p>
          ) : (
            <table className="w-full text-sm mb-4">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Employee</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Position</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Gross (BOB)</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Deductions</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {employees.map((emp: any) => {
                  const l = getLine(emp);
                  const net = Number(l.gross) - Number(l.deductions);
                  const name = emp.user
                    ? `${emp.user.first_name} ${emp.user.last_name}`.trim()
                    : emp.employee_code;
                  return (
                    <tr key={emp.id}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-800">{name}</div>
                        <div className="text-xs text-gray-400">{emp.employee_code}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-600">{emp.position ?? '—'}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step="0.01"
                          value={l.gross}
                          onChange={(e) => setLine(emp.id, 'gross', e.target.value)}
                          className="border border-gray-300 rounded px-2 py-1 text-sm w-28 text-right"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step="0.01"
                          value={l.deductions}
                          onChange={(e) => setLine(emp.id, 'deductions', e.target.value)}
                          className="border border-gray-300 rounded px-2 py-1 text-sm w-24 text-right"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-gray-800">{fmt(net)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-gray-300 bg-gray-50">
                <tr>
                  <td colSpan={2} className="px-3 py-2 font-semibold text-gray-700">Total</td>
                  <td className="text-right px-3 py-2 font-semibold text-gray-800">
                    {fmt(employees.reduce((s: number, e: any) => s + Number(getLine(e).gross), 0))}
                  </td>
                  <td className="text-right px-3 py-2 font-semibold text-red-600">
                    {fmt(employees.reduce((s: number, e: any) => s + Number(getLine(e).deductions), 0))}
                  </td>
                  <td className="text-right px-3 py-2 font-semibold text-blue-700">
                    {fmt(employees.reduce((s: number, e: any) => s + Number(getLine(e).gross) - Number(getLine(e).deductions), 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          {runError && (
            <div className="flex items-center gap-2 text-red-600 text-sm mb-3">
              <AlertCircle className="w-4 h-4 shrink-0" /> {runError}
            </div>
          )}
          {runSuccess && (
            <div className="flex items-center gap-2 text-green-600 text-sm mb-3">
              <CheckCircle className="w-4 h-4 shrink-0" /> {runSuccess}
            </div>
          )}

          <button
            onClick={() => runPayroll.mutate()}
            disabled={runPayroll.isPending || employees.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm rounded hover:bg-gray-800 disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            {runPayroll.isPending ? 'Processing...' : `Run Payroll — ${MONTHS[month - 1]} ${year}`}
          </button>
        </div>

        {/* Past runs */}
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <h2 className="font-semibold text-gray-800 mb-4">Past Payroll Runs</h2>
          {runs.length === 0 ? (
            <p className="text-sm text-gray-400">No payroll runs yet.</p>
          ) : (
            <div className="space-y-2">
              {runs.map((run: any) => (
                <div key={run.id} className="border border-gray-200 rounded">
                  <button
                    className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-gray-50"
                    onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                  >
                    <div>
                      <div className="font-medium text-gray-800">{run.description}</div>
                      <div className="text-xs text-gray-400">{run.entry_number}</div>
                    </div>
                    {expandedRun === run.id ? (
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                  {expandedRun === run.id && (
                    <div className="border-t border-gray-200 px-3 py-2 space-y-1">
                      {run.lines.map((l: any) => (
                        <div key={l.id} className="flex justify-between text-xs text-gray-600">
                          <span>{l.account.code} {l.account.name}</span>
                          <span>
                            {Number(l.debit_amount) > 0
                              ? <span className="text-blue-600">Dr {fmt(Number(l.debit_amount))}</span>
                              : <span className="text-orange-600">Cr {fmt(Number(l.credit_amount))}</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
