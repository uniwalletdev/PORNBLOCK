import { useQuery } from "@tanstack/react-query";
import api from "../lib/api.js";

const TYPE_STYLE = {
  dns_block:   "bg-blue-100 text-blue-700",
  nsfw_screen: "bg-red-100 text-red-700",
  manual:      "bg-gray-100 text-gray-600",
};

export default function ViolationsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["violations"],
    queryFn:  () => api.get("/violations").then((r) => r.data.violations ?? []),
  });

  if (isLoading) return <p className="text-gray-400 text-sm">Loading…</p>;
  if (isError)   return <p className="text-red-500 text-sm">Failed to load violations.</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Violations</h1>

      {data.length === 0 ? (
        <p className="text-sm text-gray-400">No violations recorded.</p>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">URL / Domain</th>
                <th className="px-4 py-3 text-left font-medium">Confidence</th>
                <th className="px-4 py-3 text-left font-medium">Device</th>
                <th className="px-4 py-3 text-left font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((v) => (
                <tr key={v.id}>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_STYLE[v.violation_type] ?? ""}`}>
                      {v.violation_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 truncate max-w-xs">{v.url ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {v.confidence_score != null ? `${(v.confidence_score * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{v.device_id?.slice(0, 8)}…</td>
                  <td className="px-4 py-3 text-gray-400">
                    {new Date(v.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
