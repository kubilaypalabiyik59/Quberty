'use client';

import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, buttonVariants } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { Upload, CheckCircle, AlertCircle, ArrowRight } from 'lucide-react';

const IMPORT_TYPES = [
  { value: 'products', label: 'Products' },
  { value: 'customers', label: 'Customers' },
  { value: 'inventory', label: 'Opening Stock' },
  { value: 'orders', label: 'Historical Orders' },
];

const FIELD_OPTIONS: Record<string, string[]> = {
  products: ['sku', 'barcode', 'name', 'description', 'category', 'brand', 'selling_price', 'cost_price', 'weight_kg'],
  customers: ['code', 'first_name', 'last_name', 'email', 'phone', 'address', 'city', 'segment'],
  inventory: ['sku', 'variant_sku', 'warehouse_code', 'location_code', 'quantity', 'unit_cost'],
  orders: ['order_number', 'customer_code', 'sku', 'quantity', 'unit_price', 'order_date', 'status'],
};

export default function ImportPage() {
  const [step, setStep] = useState<'upload' | 'map' | 'validate' | 'execute'>('upload');
  const [importType, setImportType] = useState('products');
  const [jobId, setJobId] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [isDragging, setIsDragging] = useState(false);
  const qc = useQueryClient();

  const { data: jobs } = useQuery({
    queryKey: ['import-jobs'],
    queryFn: () => api.get('/import/jobs').then((r) => r.data.data),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('import_type', importType);
      return api.post('/import/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: (res) => {
      setJobId(res.data.data.job_id);
      setHeaders(res.data.data.headers);
      setStep('map');
    },
  });

  const saveMappingMutation = useMutation({
    mutationFn: () => api.post(`/import/jobs/${jobId}/mapping`, { mapping }),
    onSuccess: () => setStep('validate'),
  });

  const validateMutation = useMutation({
    mutationFn: () => api.post(`/import/jobs/${jobId}/validate`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['import-jobs'] });
      if (res.data.data.status === 'VALID') setStep('execute');
    },
  });

  const executeMutation = useMutation({
    mutationFn: () => api.post(`/import/jobs/${jobId}/execute`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['import-jobs'] }); setStep('upload'); },
  });

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadMutation.mutate(file);
  }, []);

  const STEPS = ['upload', 'map', 'validate', 'execute'];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Data Import</h1>
        <p className="text-gray-500">Upload Excel or CSV files to import data</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 p-4">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step === s ? 'bg-gray-900 text-white' : STEPS.indexOf(step) > i ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-500'
            }`}>
              {STEPS.indexOf(step) > i ? <CheckCircle className="h-4 w-4" /> : i + 1}
            </div>
            <span className={`text-sm capitalize ${step === s ? 'font-medium text-gray-900' : 'text-gray-400'}`}>{s}</span>
            {i < STEPS.length - 1 && <ArrowRight className="h-4 w-4 text-gray-300 mx-1" />}
          </div>
        ))}
      </div>

      {/* STEP 1: Upload */}
      {step === 'upload' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {IMPORT_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setImportType(t.value)}
                className={`p-3 rounded-lg border-2 text-sm font-medium transition-colors ${
                  importType === t.value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
              isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <Upload className="h-10 w-10 mx-auto mb-3 text-gray-300" />
            <p className="font-medium text-gray-700">Drop your Excel or CSV file here</p>
            <p className="text-sm text-gray-400 mt-1">or click to browse</p>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              id="file-input"
              onChange={(e) => e.target.files?.[0] && uploadMutation.mutate(e.target.files[0])}
            />
            {/* Was a <Button as="span">, but Button never supported `as`, so it
                rendered a real <button> nested inside the label — clicking it
                did nothing on some browsers. A styled label is the correct
                control for a file input. */}
            <label
              htmlFor="file-input"
              className={cn(buttonVariants({ variant: 'outline' }), 'mt-4')}
            >
              Browse Files
            </label>
          </div>
        </div>
      )}

      {/* STEP 2: Column Mapping */}
      {step === 'map' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Map Columns</h2>
          <p className="text-sm text-gray-500">Match your Excel columns to Skarpine fields</p>

          <div className="space-y-3">
            {headers.map((header) => (
              <div key={header} className="flex items-center gap-4">
                <span className="w-48 text-sm font-medium text-gray-700 bg-gray-50 px-3 py-2 rounded border border-gray-200">
                  {header}
                </span>
                <ArrowRight className="h-4 w-4 text-gray-400 shrink-0" />
                <select
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={mapping[header] ?? ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [header]: e.target.value }))}
                >
                  <option value="">-- Skip this column --</option>
                  {FIELD_OPTIONS[importType]?.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="flex gap-3 pt-2">
            <Button onClick={() => setStep('upload')} variant="outline">Back</Button>
            <Button onClick={() => saveMappingMutation.mutate()} disabled={saveMappingMutation.isPending}>
              Save Mapping
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3: Validate */}
      {step === 'validate' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Validate Data</h2>
          <p className="text-sm text-gray-500">Run validation to check for errors before importing</p>

          <Button onClick={() => validateMutation.mutate()} disabled={validateMutation.isPending}>
            {validateMutation.isPending ? 'Validating...' : 'Run Validation'}
          </Button>

          {validateMutation.data && (
            <div className={`p-4 rounded-lg ${
              validateMutation.data.data.data.status === 'VALID' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
            }`}>
              {validateMutation.data.data.data.status === 'VALID' ? (
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle className="h-5 w-5" />
                  <span>All rows are valid! Ready to import.</span>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2 text-red-700 mb-2">
                    <AlertCircle className="h-5 w-5" />
                    <span>{validateMutation.data.data.data.errors?.length} error(s) found</span>
                  </div>
                  {validateMutation.data.data.data.errors?.map((e: any, i: number) => (
                    <p key={i} className="text-sm text-red-600">Row {e.row}: {e.message}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* STEP 4: Execute */}
      {step === 'execute' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Execute Import</h2>
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <span className="text-green-700">Validation passed. Ready to import.</span>
          </div>
          <p className="text-sm text-gray-500">This action will permanently import the data into Skarpine.</p>
          <Button onClick={() => executeMutation.mutate()} disabled={executeMutation.isPending}>
            {executeMutation.isPending ? 'Importing...' : 'Execute Import'}
          </Button>
        </div>
      )}

      {/* Import History */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Import History</h2>
        <div className="space-y-2">
          {(jobs ?? []).map((job: any) => (
            <div key={job.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
              <div>
                <span className="text-sm font-medium text-gray-900">{job.file_name}</span>
                <span className="text-xs text-gray-400 ml-2">({job.import_type})</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">{new Date(job.created_at).toLocaleString()}</span>
                <Badge color={job.status === 'COMPLETED' ? 'green' : job.status === 'FAILED' ? 'red' : 'gray'}>
                  {job.status}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
