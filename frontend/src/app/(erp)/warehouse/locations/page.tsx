'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus, Warehouse, ChevronRight, MapPin, Layers, AlertCircle, Check } from 'lucide-react';

type Tab = 'warehouses' | 'zones' | 'locations';

export default function WarehouseLocationsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('warehouses');
  const [selectedWarehouse, setSelectedWarehouse] = useState<any>(null);
  const [selectedZone, setSelectedZone] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  // Warehouse form
  const [wForm, setWForm] = useState({ code: '', name: '', type: 'standard', site_city: 'La Paz', site_country: 'BO' });
  // Zone form
  const [zForm, setZForm] = useState({ code: '', name: '', zone_type: 'storage' });
  // Location form
  const [lForm, setLForm] = useState({
    code: '', aisle: '', rack: '', shelf: '', bin: '',
    location_type: 'bulk', is_pick_location: false, is_receive_location: false,
  });

  const { data: warehouses, isLoading: wLoading } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/warehouse/warehouses').then(r => r.data.data),
  });

  const { data: zones, isLoading: zLoading } = useQuery({
    queryKey: ['zones', selectedWarehouse?.id],
    queryFn: () => api.get(`/warehouse/zones?warehouse_id=${selectedWarehouse.id}`).then(r => r.data.data),
    enabled: !!selectedWarehouse,
  });

  const { data: locations, isLoading: lLoading } = useQuery({
    queryKey: ['locations', selectedZone?.id],
    queryFn: () => api.get(`/warehouse/locations?zone_id=${selectedZone.id}`).then(r => r.data.data),
    enabled: !!selectedZone,
  });

  const createWarehouse = useMutation({
    mutationFn: () => api.post('/warehouse/warehouses', wForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['warehouses'] }); setShowForm(false); setWForm({ code: '', name: '', type: 'standard', site_city: 'La Paz', site_country: 'BO' }); setError(''); },
    onError: (err: any) => setError(err.response?.data?.message ?? 'Failed to create warehouse'),
  });

  const createZone = useMutation({
    mutationFn: () => api.post('/warehouse/zones', { ...zForm, warehouse_id: selectedWarehouse?.id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['zones', selectedWarehouse?.id] }); setShowForm(false); setZForm({ code: '', name: '', zone_type: 'storage' }); setError(''); },
    onError: (err: any) => setError(err.response?.data?.message ?? 'Failed to create zone'),
  });

  const createLocation = useMutation({
    mutationFn: () => api.post('/warehouse/locations', { ...lForm, zone_id: selectedZone?.id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['locations', selectedZone?.id] }); setShowForm(false); setLForm({ code: '', aisle: '', rack: '', shelf: '', bin: '', location_type: 'bulk', is_pick_location: false, is_receive_location: false }); setError(''); },
    onError: (err: any) => setError(err.response?.data?.message ?? 'Failed to create location'),
  });

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition-colors ${tab === t ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Warehouse Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {tab === 'warehouses' && 'Create and manage your warehouses'}
            {tab === 'zones' && (selectedWarehouse ? `Zones in ${selectedWarehouse.name}` : 'Select a warehouse first')}
            {tab === 'locations' && (selectedZone ? `Locations in zone ${selectedZone.name}` : 'Select a zone first')}
          </p>
        </div>
        <button
          onClick={() => { setShowForm(true); setError(''); }}
          disabled={tab === 'zones' && !selectedWarehouse || tab === 'locations' && !selectedZone}
          className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="h-4 w-4" />
          {tab === 'warehouses' && 'New Warehouse'}
          {tab === 'zones' && 'New Zone'}
          {tab === 'locations' && 'New Location'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-5 bg-gray-50 p-1 rounded-xl w-fit">
        <button className={tabClass('warehouses')} onClick={() => setTab('warehouses')}>
          <Warehouse className="h-4 w-4 inline mr-1.5" />Warehouses
        </button>
        <button
          className={tabClass('zones')}
          onClick={() => setTab('zones')}
        >
          <Layers className="h-4 w-4 inline mr-1.5" />Zones
          {selectedWarehouse && <span className="ml-1.5 text-xs opacity-75">({selectedWarehouse.name})</span>}
        </button>
        <button
          className={tabClass('locations')}
          onClick={() => setTab('locations')}
        >
          <MapPin className="h-4 w-4 inline mr-1.5" />Locations
          {selectedZone && <span className="ml-1.5 text-xs opacity-75">({selectedZone.name})</span>}
        </button>
      </div>

      {/* Breadcrumb */}
      {(selectedWarehouse || selectedZone) && (
        <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
          <button onClick={() => { setSelectedWarehouse(null); setSelectedZone(null); setTab('warehouses'); }} className="hover:text-blue-600">All Warehouses</button>
          {selectedWarehouse && <><ChevronRight className="h-3 w-3" /><button onClick={() => { setSelectedZone(null); setTab('zones'); }} className="hover:text-blue-600">{selectedWarehouse.name}</button></>}
          {selectedZone && <><ChevronRight className="h-3 w-3" /><span className="text-gray-600">{selectedZone.name}</span></>}
        </div>
      )}

      {/* Forms */}
      {showForm && tab === 'warehouses' && (
        <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-6 mb-6">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">New Warehouse</h2>
          <div className="grid grid-cols-2 gap-4">
            {[
              { key: 'code', label: 'Warehouse Code *', placeholder: 'WH-001' },
              { key: 'name', label: 'Warehouse Name *', placeholder: 'Main Warehouse' },
              { key: 'site_city', label: 'City', placeholder: 'La Paz' },
              { key: 'site_country', label: 'Country Code', placeholder: 'BO' },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={placeholder}
                  value={(wForm as any)[key]}
                  onChange={e => setWForm(p => ({ ...p, [key]: e.target.value }))} />
              </div>
            ))}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={wForm.type} onChange={e => setWForm(p => ({ ...p, type: e.target.value }))}>
                {['standard', 'distribution', 'cold', 'bonded'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          {error && <div className="flex items-center gap-2 mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle className="h-4 w-4" />{error}</div>}
          <div className="flex gap-3 mt-4">
            <button onClick={() => createWarehouse.mutate()} disabled={!wForm.code || !wForm.name || createWarehouse.isPending}
              className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors">
              <Check className="h-4 w-4" />{createWarehouse.isPending ? 'Creating...' : 'Create Warehouse'}
            </button>
            <button onClick={() => setShowForm(false)} className="border border-gray-200 text-gray-600 px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {showForm && tab === 'zones' && selectedWarehouse && (
        <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-6 mb-6">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">New Zone in {selectedWarehouse.name}</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Zone Code *</label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="ZONE-A" value={zForm.code} onChange={e => setZForm(p => ({ ...p, code: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Zone Name *</label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Zone A - Receiving" value={zForm.name} onChange={e => setZForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Zone Type</label>
              <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={zForm.zone_type} onChange={e => setZForm(p => ({ ...p, zone_type: e.target.value }))}>
                {['storage', 'receiving', 'shipping', 'staging', 'quality', 'returns'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          {error && <div className="flex items-center gap-2 mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle className="h-4 w-4" />{error}</div>}
          <div className="flex gap-3 mt-4">
            <button onClick={() => createZone.mutate()} disabled={!zForm.code || !zForm.name || createZone.isPending}
              className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors">
              <Check className="h-4 w-4" />{createZone.isPending ? 'Creating...' : 'Create Zone'}
            </button>
            <button onClick={() => setShowForm(false)} className="border border-gray-200 text-gray-600 px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {showForm && tab === 'locations' && selectedZone && (
        <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-6 mb-6">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">New Location in {selectedZone.name}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location Code *</label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="A-01-01" value={lForm.code} onChange={e => setLForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={lForm.location_type} onChange={e => setLForm(p => ({ ...p, location_type: e.target.value }))}>
                {['bulk', 'shelf', 'rack', 'bin', 'floor', 'staging'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Aisle</label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="A" value={lForm.aisle} onChange={e => setLForm(p => ({ ...p, aisle: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rack</label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="01" value={lForm.rack} onChange={e => setLForm(p => ({ ...p, rack: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Shelf</label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="01" value={lForm.shelf} onChange={e => setLForm(p => ({ ...p, shelf: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bin</label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Optional" value={lForm.bin} onChange={e => setLForm(p => ({ ...p, bin: e.target.value }))} />
            </div>
          </div>
          <div className="flex items-center gap-6 mt-4">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
              <input type="checkbox" checked={lForm.is_pick_location} onChange={e => setLForm(p => ({ ...p, is_pick_location: e.target.checked }))}
                className="w-4 h-4 rounded accent-blue-600" />
              Pick Location
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
              <input type="checkbox" checked={lForm.is_receive_location} onChange={e => setLForm(p => ({ ...p, is_receive_location: e.target.checked }))}
                className="w-4 h-4 rounded accent-blue-600" />
              Receive Location
            </label>
          </div>
          {error && <div className="flex items-center gap-2 mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle className="h-4 w-4" />{error}</div>}
          <div className="flex gap-3 mt-4">
            <button onClick={() => createLocation.mutate()} disabled={!lForm.code || createLocation.isPending}
              className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors">
              <Check className="h-4 w-4" />{createLocation.isPending ? 'Creating...' : 'Create Location'}
            </button>
            <button onClick={() => setShowForm(false)} className="border border-gray-200 text-gray-600 px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* WAREHOUSES TAB */}
      {tab === 'warehouses' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {wLoading && Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 h-32 animate-pulse" />
          ))}
          {!wLoading && (warehouses ?? []).length === 0 && (
            <div className="col-span-3 text-center py-20 text-gray-400">
              <Warehouse className="h-12 w-12 mx-auto mb-3 text-gray-200" />
              <p className="font-medium text-gray-600">No warehouses yet</p>
              <p className="text-sm mt-1">Create your first warehouse to start managing locations</p>
            </div>
          )}
          {(warehouses ?? []).map((w: any) => (
            <button
              key={w.id}
              onClick={() => { setSelectedWarehouse(w); setSelectedZone(null); setTab('zones'); setShowForm(false); }}
              className="bg-white rounded-xl border border-gray-200 p-5 text-left hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Warehouse className="h-5 w-5 text-blue-500" />
                  <div>
                    <p className="font-semibold text-gray-900">{w.name}</p>
                    <p className="text-xs text-gray-400 font-mono">{w.code}</p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-gray-300" />
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{w.site?.city ?? '—'} · {w.type}</span>
                <span>{w.zones?.length ?? 0} zones</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ZONES TAB */}
      {tab === 'zones' && (
        <div>
          {!selectedWarehouse ? (
            <div className="text-center py-20 text-gray-400">
              <Layers className="h-12 w-12 mx-auto mb-3 text-gray-200" />
              <p>Select a warehouse first from the Warehouses tab</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {zLoading && Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 h-28 animate-pulse" />
              ))}
              {!zLoading && (zones ?? []).length === 0 && (
                <div className="col-span-3 text-center py-20 text-gray-400">
                  <Layers className="h-12 w-12 mx-auto mb-3 text-gray-200" />
                  <p className="font-medium text-gray-600">No zones in {selectedWarehouse.name}</p>
                  <p className="text-sm mt-1">Create a zone to start adding locations</p>
                </div>
              )}
              {(zones ?? []).map((z: any) => (
                <button
                  key={z.id}
                  onClick={() => { setSelectedZone(z); setTab('locations'); setShowForm(false); }}
                  className="bg-white rounded-xl border border-gray-200 p-5 text-left hover:border-blue-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-gray-900">{z.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{z.code}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-gray-300" />
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span className="capitalize">{z.zone_type}</span>
                    <span>{z._count?.locations ?? 0} locations</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* LOCATIONS TAB */}
      {tab === 'locations' && (
        <div>
          {!selectedZone ? (
            <div className="text-center py-20 text-gray-400">
              <MapPin className="h-12 w-12 mx-auto mb-3 text-gray-200" />
              <p>Select a zone first from the Zones tab</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Code</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Aisle</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Rack</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Shelf</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Pick</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Receive</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lLoading && Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                    ))}</tr>
                  ))}
                  {!lLoading && (locations ?? []).length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                      <MapPin className="h-8 w-8 mx-auto mb-2 text-gray-200" />
                      <p>No locations in this zone yet.</p>
                    </td></tr>
                  )}
                  {(locations ?? []).map((loc: any) => (
                    <tr key={loc.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono font-semibold text-gray-900">{loc.code}</td>
                      <td className="px-4 py-3 text-gray-500 capitalize">{loc.location_type}</td>
                      <td className="px-4 py-3 text-gray-500">{loc.aisle ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{loc.rack ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{loc.shelf ?? '—'}</td>
                      <td className="px-4 py-3 text-center">
                        {loc.is_pick_location ? <span className="text-green-600 font-bold">✓</span> : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {loc.is_receive_location ? <span className="text-green-600 font-bold">✓</span> : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
