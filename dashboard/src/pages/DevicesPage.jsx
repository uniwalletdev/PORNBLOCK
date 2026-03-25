import { useQuery } from "@tanstack/react-query";
import api from "../lib/api.js";

const STATUS_BADGE = {
  active:   "bg-green-100 text-green-700",
  inactive: "bg-yellow-100 text-yellow-700",
  tampered: "bg-red-100 text-red-700",
};

export default function DevicesPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["devices"],
    queryFn:  () => api.get("/devices").then((r) => r.data.devices ?? []),
  });

  if (isLoading) return <p className="text-gray-400 text-sm">Loading…</p>;
  if (isError)   return <p className="text-red-500 text-sm">Failed to load devices.</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Devices</h1>

      {data.length === 0 ? (
        <p className="text-sm text-gray-400">No devices enrolled yet.</p>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Platform</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Last Heartbeat</th>
                <th className="px-4 py-3 text-left font-medium">App Version</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3 font-medium">{d.device_name}</td>
                  <td className="px-4 py-3 text-gray-500 capitalize">{d.platform ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[d.protection_status] ?? ""}`}>
                      {d.protection_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {d.last_heartbeat ? new Date(d.last_heartbeat).toLocaleString() : "Never"}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{d.app_version ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
