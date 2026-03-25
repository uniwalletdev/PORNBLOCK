import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api.js";

export default function BlocklistPage() {
  const qc = useQueryClient();
  const [newDomain, setNewDomain] = useState("");
  const [error, setError]         = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["blocklist"],
    queryFn:  () => api.get("/policy/blocklist").then((r) => r.data),
  });

  const addMutation = useMutation({
    mutationFn: (domain) => api.post("/policy/blocklist", { domain }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["blocklist"] });
      setNewDomain("");
      setError(null);
    },
    onError: (err) => setError(err.response?.data?.error ?? "Failed to add domain"),
  });

  const removeMutation = useMutation({
    mutationFn: (domain) => api.delete(`/policy/blocklist/${encodeURIComponent(domain)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blocklist"] }),
  });

  function handleAdd(e) {
    e.preventDefault();
    const d = newDomain.trim().toLowerCase();
    if (!d) return;
    addMutation.mutate(d);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Custom Blocklist</h1>

      {/* Add domain form */}
      <form onSubmit={handleAdd} className="flex gap-2 mb-6">
        <input
          type="text"
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          placeholder="example.com"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          type="submit"
          disabled={addMutation.isPending || !newDomain.trim()}
          className="bg-brand-700 hover:bg-brand-900 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 transition-colors"
        >
          Add Domain
        </button>
      </form>
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {isLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm divide-y divide-gray-100">
          {(data?.domains ?? []).length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400">No custom domains in blocklist.</p>
          ) : (
            (data?.domains ?? []).map((domain) => (
              <div key={domain} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-mono text-gray-700">{domain}</span>
                <button
                  onClick={() => removeMutation.mutate(domain)}
                  className="text-xs text-red-500 hover:text-red-700 transition-colors"
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
