import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import api from "../lib/api.js";

export default function EnrolPage() {
  const [deviceName, setDeviceName] = useState("");
  const [platform,   setPlatform]   = useState("android");
  const [result,     setResult]     = useState(null);
  const [error,      setError]      = useState(null);

  const mutation = useMutation({
    mutationFn: ({ deviceName, platform }) =>
      api.post("/enrol/generate", { device_name: deviceName, platform }).then((r) => r.data),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (err) => {
      setError(err.response?.data?.error ?? "Failed to generate enrolment code.");
      setResult(null);
    },
  });

  function handleSubmit(e) {
    e.preventDefault();
    setResult(null);
    mutation.mutate({ deviceName, platform });
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Enrol a Device</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm p-6 space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Device Name</label>
          <input
            required
            type="text"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="My Android Phone"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Platform</label>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="android">Android</option>
            <option value="ios">iOS</option>
            <option value="windows">Windows</option>
            <option value="mac">macOS</option>
            <option value="linux">Linux</option>
          </select>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full bg-brand-700 hover:bg-brand-900 text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-60 transition-colors"
        >
          {mutation.isPending ? "Generating…" : "Generate QR Code"}
        </button>
      </form>

      {result && (
        <div className="bg-white rounded-2xl shadow-sm p-6 text-center">
          <p className="text-sm font-medium text-gray-700 mb-3">
            Scan with the PORNBLOCK Android app to enrol <strong>{deviceName}</strong>
          </p>
          <img
            src={result.qr_data_url}
            alt="Enrolment QR code"
            className="mx-auto w-48 h-48 rounded-lg border border-gray-200"
          />
          <p className="mt-3 text-xs text-gray-400 break-all">{result.enrolment_url}</p>
          <div className="flex justify-center gap-3 mt-4">
            <button
              onClick={() => navigator.clipboard.writeText(result.enrolment_url)}
              className="text-xs text-brand-700 hover:underline"
            >
              Copy link
            </button>
            <a
              href={`/api/enrol/${result.token}/qr`}
              download="enrolment-qr.png"
              className="text-xs text-brand-700 hover:underline"
            >
              Download PNG
            </a>
          </div>
          <p className="mt-3 text-xs text-amber-600">
            This code expires in 24 hours and can only be used once.
          </p>
        </div>
      )}
    </div>
  );
}
