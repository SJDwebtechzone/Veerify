import { ReactNode, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, MoreVertical, Search } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  width?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  searchKeys?: (keyof T)[];
  pageSize?: number;
  title?: string;
  toolbar?: ReactNode;
  onRowAction?: (row: T) => void;
}

export function DataTable<T extends { id: string | number }>({
  columns,
  data,
  searchKeys,
  pageSize = 8,
  title,
  toolbar,
  onRowAction,
}: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    if (!query.trim() || !searchKeys?.length) return data;
    const q = query.toLowerCase();
    return data.filter((row) =>
      searchKeys.some((k) => String(row[k] ?? '').toLowerCase().includes(q)),
    );
  }, [data, query, searchKeys]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, totalPages);
  const pageRows = filtered.slice((current - 1) * pageSize, current * pageSize);

  return (
    <div className="card overflow-hidden">
      {(title || searchKeys || toolbar) && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-5 border-b border-slate-200 dark:border-slate-800">
          {title && <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>}
          <div className="flex items-center gap-2 ml-auto">
            {searchKeys && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search…"
                  className="h-9 w-44 sm:w-56 pl-9 pr-3 text-xs rounded-lg bg-slate-100/80 dark:bg-slate-800/60 border border-transparent focus:border-brand-400 focus:bg-white dark:focus:bg-slate-900 outline-none transition-all"
                />
              </div>
            )}
            {toolbar}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-left">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400',
                    col.className,
                  )}
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.header}
                </th>
              ))}
              {onRowAction && <th className="px-5 py-3 w-10" />}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (onRowAction ? 1 : 0)}
                  className="text-center py-12 text-sm text-slate-500"
                >
                  No results found.
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-slate-100 dark:border-slate-800/60 last:border-0 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                >
                  {columns.map((col) => (
                    <td key={col.key} className={cn('px-5 py-3.5', col.className)}>
                      {col.render(row)}
                    </td>
                  ))}
                  {onRowAction && (
                    <td className="px-5 py-3.5">
                      <button
                        onClick={() => onRowAction(row)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Showing <span className="font-semibold text-slate-900 dark:text-white">{(current - 1) * pageSize + 1}</span> to{' '}
            <span className="font-semibold text-slate-900 dark:text-white">{Math.min(current * pageSize, filtered.length)}</span> of{' '}
            <span className="font-semibold text-slate-900 dark:text-white">{filtered.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              disabled={current === 1}
              onClick={() => setPage(current - 1)}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 font-semibold">
              {current} / {totalPages}
            </span>
            <button
              disabled={current === totalPages}
              onClick={() => setPage(current + 1)}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
