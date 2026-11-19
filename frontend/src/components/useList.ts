import { useCallback, useEffect, useState } from 'react';
import { api, qs, Paginated } from '../lib/api';

export function useList<T>(endpoint: string, extraParams: Record<string, any> = {}) {
  const [rows, setRows] = useState<T[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pageSize: 20, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<string | undefined>(undefined);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const extraKey = JSON.stringify(extraParams);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res: Paginated<T> = await api.get(
        endpoint + qs({ page, pageSize: 20, search, sortBy, sortDir, ...extraParams }),
      );
      setRows(res.data);
      setMeta({ total: res.total, page: res.page, pageSize: res.pageSize, totalPages: res.totalPages });
    } catch (e: any) {
      setError(e.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [endpoint, page, search, sortBy, sortDir, extraKey]);

  useEffect(() => { load(); }, [load]);

  const onSort = (key: string) => {
    if (sortBy === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir('asc'); }
  };

  return { rows, meta, page, setPage, search, setSearch, sortBy, sortDir, onSort, loading, error, reload: load };
}
