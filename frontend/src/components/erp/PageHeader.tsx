import { cn } from '@/lib/utils';

/**
 * Page heading, written against tokens.
 *
 * Existing pages open with `text-2xl font-bold text-gray-900` typed by hand,
 * which is both an arbitrary size and a legacy palette class — the two things
 * the design system exists to remove. New pages use this instead.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-5 flex flex-wrap items-end justify-between gap-3', className)}>
      <div>
        <h1 className="text-title font-semibold text-fg">{title}</h1>
        {subtitle && <p className="mt-0.5 text-caption text-fg-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Dense table shell — border, surface, and horizontal scroll that stays inside. */
export function TableShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-surface border border-border bg-surface', className)}>
      <table className="w-full text-body">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'whitespace-nowrap border-b border-border px-3 py-2 text-left text-micro font-semibold uppercase tracking-wide text-fg-muted',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn('h-row px-3 py-1.5 align-middle text-fg', className)}>{children}</td>;
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-caption text-fg-muted">
        {children}
      </td>
    </tr>
  );
}

export function LoadingRows({ rows = 5, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: cols }).map((__, j) => (
            <td key={j} className="h-row px-3 py-1.5">
              <div className="h-3.5 animate-pulse rounded bg-surface-sunken" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function ErrorNote({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="mb-4 rounded-control border border-danger/25 bg-danger-soft px-3 py-2 text-caption text-danger">
      {message}
    </div>
  );
}
