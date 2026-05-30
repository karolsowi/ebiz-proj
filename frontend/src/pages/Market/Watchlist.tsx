import { useEffect, useState } from "react";
import PageMeta from "../../components/common/PageMeta";
import { apiClient } from "../../services/apiClient";
import { apiUrl } from "../../utils/apiUrl";

interface WatchlistEntry {
  id: number;
  symbol: string;
  name?: string | null;
  notes?: string | null;
  addedAt: string;
}

export default function Watchlist() {
  const [items, setItems] = useState<WatchlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<WatchlistEntry[]>(apiUrl("/api/watchlist"));
      setItems(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load watchlist");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol.trim()) return;
    setError(null);
    try {
      if (editingId) {
        await apiClient.put(apiUrl(`/api/watchlist/${editingId}`), {
          name: name || undefined,
          notes: notes || undefined,
        });
      } else {
        await apiClient.post(apiUrl("/api/watchlist"), {
          symbol: symbol.toUpperCase(),
          name: name || undefined,
          notes: notes || undefined,
        });
      }
      setSymbol("");
      setName("");
      setNotes("");
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const startEdit = (item: WatchlistEntry) => {
    setEditingId(item.id);
    setSymbol(item.symbol);
    setName(item.name ?? "");
    setNotes(item.notes ?? "");
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Remove from watchlist?")) return;
    try {
      await apiClient.delete(apiUrl(`/api/watchlist/${id}`));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <>
      <PageMeta title="Watchlist" description="Track symbols you follow" />
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white">Watchlist</h1>

        {error && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </p>
        )}

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
        >
          <h2 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">
            {editingId ? "Edit symbol" : "Add symbol"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <input
              className="rounded-lg border px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-400"
              placeholder="Symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              disabled={!!editingId}
              required={!editingId}
            />
            <input
              className="rounded-lg border px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-400"
              placeholder="Company name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="rounded-lg border px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-400"
              placeholder="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="mt-4 flex gap-3">
            <button
              type="submit"
              className="rounded-lg bg-brand-500 px-4 py-2 text-white hover:bg-brand-600"
            >
              {editingId ? "Update" : "Add"}
            </button>
            {editingId && (
              <button
                type="button"
                className="rounded-lg border px-4 py-2 text-gray-700 dark:border-gray-700 dark:text-gray-300"
                onClick={() => {
                  setEditingId(null);
                  setSymbol("");
                  setName("");
                  setNotes("");
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          {loading ? (
            <p className="p-6 text-gray-500 dark:text-gray-400">Loading...</p>
          ) : items.length === 0 ? (
            <p className="p-6 text-gray-500 dark:text-gray-400">Watchlist is empty. Add a symbol above.</p>
          ) : (
            <ul className="divide-y dark:divide-gray-800">
              {items.map((item) => (
                <li key={item.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-semibold text-gray-800 dark:text-white">{item.symbol}</p>
                    {item.name && <p className="text-sm text-gray-500 dark:text-gray-400">{item.name}</p>}
                    {item.notes && <p className="text-sm text-gray-400 dark:text-gray-500">{item.notes}</p>}
                  </div>
                  <div className="space-x-2">
                    <button
                      type="button"
                      className="text-brand-500 hover:underline"
                      onClick={() => startEdit(item)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-red-500 hover:underline"
                      onClick={() => handleDelete(item.id)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
