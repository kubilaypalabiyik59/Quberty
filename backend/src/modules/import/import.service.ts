import * as XLSX from 'xlsx';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { logger } from '../../shared/logger';

/**
 * Data Import Module
 * Supports Excel/CSV upload with column mapping and validation
 */
export class ImportService {

  async uploadFile(
    tenantId: string,
    importType: ImportType,
    fileName: string,
    fileBuffer: Buffer,
    userId: string
  ) {
    // Parse Excel/CSV
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    if (rows.length < 2) throw new AppError('File must have at least a header row and one data row');

    const headers = rows[0].map((h: any) => String(h).trim());
    const dataRows = rows.slice(1).filter((r) => r.some((c) => c !== '' && c !== null));

    // Store file + create job
    const job = await db.importJob.create({
      data: {
        tenant_id: tenantId,
        import_type: importType,
        file_name: fileName,
        file_url: '', // In production: store in S3/Supabase
        status: 'PENDING',
        total_rows: dataRows.length,
        created_by: userId,
        column_mapping: { detected_headers: headers },
      },
    });

    return { job_id: job.id, headers, row_count: dataRows.length, sample_rows: dataRows.slice(0, 5) };
  }

  async saveColumnMapping(tenantId: string, jobId: string, mapping: Record<string, string>) {
    const job = await this.getJobOrThrow(tenantId, jobId);

    if (!['PENDING', 'INVALID'].includes(job.status)) {
      throw new AppError('Cannot modify mapping for job in current state');
    }

    return db.importJob.update({
      where: { id: jobId },
      data: { column_mapping: { ...job.column_mapping as object, user_mapping: mapping }, status: 'PENDING' },
    });
  }

  async validateJob(tenantId: string, jobId: string) {
    const job = await this.getJobOrThrow(tenantId, jobId);

    await db.importJob.update({
      where: { id: jobId },
      data: { status: 'VALIDATING' },
    });

    const errors: ValidationError[] = [];
    const mapping = (job.column_mapping as any)?.user_mapping ?? {};

    // Load actual data from stored file (simplified — in prod read from S3)
    // For demo, run type-specific validators
    const validator = this.getValidator(job.import_type as ImportType);
    const validationResult = await validator(tenantId, mapping, errors);

    const status = errors.length === 0 ? 'VALID' : 'INVALID';

    await db.importJob.update({
      where: { id: jobId },
      data: {
        status,
        valid_rows: validationResult.valid_rows,
        error_rows: errors.length,
        errors: errors as any,
      },
    });

    return { status, valid_rows: validationResult.valid_rows, errors };
  }

  async executeImport(tenantId: string, jobId: string, userId: string) {
    const job = await this.getJobOrThrow(tenantId, jobId);

    if (job.status !== 'VALID') {
      throw new AppError('Job must be validated before executing');
    }

    await db.importJob.update({ where: { id: jobId }, data: { status: 'IMPORTING' } });

    try {
      const executor = this.getExecutor(job.import_type as ImportType);
      await executor(tenantId, job, userId);

      await db.importJob.update({
        where: { id: jobId },
        data: { status: 'COMPLETED', completed_at: new Date() },
      });
    } catch (err: any) {
      await db.importJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', errors: [{ message: err.message }] as any },
      });
      throw err;
    }
  }

  // =========================================================
  // VALIDATORS per import type
  // =========================================================

  private getValidator(type: ImportType) {
    const validators: Record<ImportType, Function> = {
      products: this.validateProducts.bind(this),
      customers: this.validateCustomers.bind(this),
      inventory: this.validateInventory.bind(this),
      orders: this.validateOrders.bind(this),
    };
    const v = validators[type];
    if (!v) throw new AppError(`Unknown import type: ${type}`);
    return v;
  }

  private async validateProducts(tenantId: string, mapping: Record<string, string>, errors: ValidationError[]) {
    const requiredFields = ['sku', 'name', 'selling_price'];
    let valid_rows = 0;

    // Check required fields are mapped
    for (const field of requiredFields) {
      if (!Object.values(mapping).includes(field)) {
        errors.push({ row: 0, field, message: `Required field '${field}' is not mapped` });
      }
    }

    return { valid_rows };
  }

  private async validateCustomers(tenantId: string, mapping: Record<string, string>, errors: ValidationError[]) {
    const requiredFields = ['first_name', 'last_name'];
    for (const field of requiredFields) {
      if (!Object.values(mapping).includes(field)) {
        errors.push({ row: 0, field, message: `Required field '${field}' is not mapped` });
      }
    }
    return { valid_rows: 0 };
  }

  private async validateInventory(_: string, mapping: Record<string, string>, errors: ValidationError[]) {
    const required = ['sku', 'location_code', 'quantity'];
    for (const f of required) {
      if (!Object.values(mapping).includes(f)) {
        errors.push({ row: 0, field: f, message: `Required field '${f}' not mapped` });
      }
    }
    return { valid_rows: 0 };
  }

  private async validateOrders(_: string, mapping: Record<string, string>, errors: ValidationError[]) {
    return { valid_rows: 0 };
  }

  // =========================================================
  // EXECUTORS per import type
  // =========================================================

  private getExecutor(type: ImportType) {
    const executors: Record<ImportType, Function> = {
      products: this.importProducts.bind(this),
      customers: this.importCustomers.bind(this),
      inventory: this.importInventory.bind(this),
      orders: this.importOrders.bind(this),
    };
    return executors[type];
  }

  private async importProducts(tenantId: string, job: any, userId: string) {
    // In production: re-read from stored file, apply mapping, upsert products
    // Simplified example:
    logger.info({ tenantId, jobId: job.id }, '[Import] Importing products');
  }

  private async importCustomers(tenantId: string, job: any, userId: string) {
    logger.info({ tenantId, jobId: job.id }, '[Import] Importing customers');
  }

  private async importInventory(tenantId: string, job: any, userId: string) {
    logger.info({ tenantId, jobId: job.id }, '[Import] Importing inventory');
  }

  private async importOrders(tenantId: string, job: any, userId: string) {
    logger.info({ tenantId, jobId: job.id }, '[Import] Importing orders');
  }

  private async getJobOrThrow(tenantId: string, jobId: string) {
    const job = await db.importJob.findFirst({ where: { id: jobId, tenant_id: tenantId } });
    if (!job) throw new AppError('Import job not found', 404);
    return job;
  }
}

type ImportType = 'products' | 'customers' | 'inventory' | 'orders';

interface ValidationError {
  row?: number;
  field?: string;
  message: string;
}
