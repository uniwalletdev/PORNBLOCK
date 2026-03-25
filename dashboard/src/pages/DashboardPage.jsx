import { useQuery } from "@tanstack/react-query";
import api from "../lib/api.js";

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-6">
      <p className="text-sm text-gray-500 font-medium">{label}</p>
      <p className="text-3xl font-bold text-brand-700 mt-1">{value ?? "—"}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const { data: devices } = useQuery({
    queryKey: ["devices"],
    queryFn:  () => api.get("/devices").then((r) => r.data.devices ?? []),
  });

  const { data: violations } = useQuery({
    queryKey: ["violations"],
    queryFn:  () => api.get("/violations").then((r) => r.data.violations ?? []),
  });

  const active   = devices?.filter((d) => d.protection_status === "active").length ?? 0;
  const total    = devices?.length ?? 0;
  const todayV   = violations?.filter((v) => {
    const ts = new Date(v.created_at);
    const now = new Date();
    return ts.toDateString() === now.toDateString();
  }).length ?? 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard label="Total Devices"      value={total}  />
        <StatCard label="Active Protection"  value={active} sub={`${total - active} inactive`} />
        <StatCard label="Violations Today"   value={todayV} />
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Recent Violations</h2>
        {violations?.length === 0 ? (
          <p className="text-sm text-gray-400">No violations recorded.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 font-medium">Device</th>
                <th className="pb-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {violations?.slice(0, 10).map((v) => (
                <tr key={v.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">{v.violation_type}</td>
                  <td className="py-2 pr-4 text-gray-500">{v.device_id?.slice(0, 8)}…</td>
                  <td className="py-2 text-gray-400">
                    {new Date(v.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
