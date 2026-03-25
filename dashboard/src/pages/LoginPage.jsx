import { SignIn } from "@clerk/react";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-50">
      <SignIn
        routing="hash"
        afterSignInUrl="/"
        appearance={{
          elements: {
            card: "shadow-lg rounded-2xl",
            headerTitle: "text-brand-700 font-bold",
            formButtonPrimary:
              "bg-brand-700 hover:bg-brand-900 text-white text-sm font-semibold",
          },
        }}
      />
    </div>
  );
}
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-50">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-brand-700 mb-6 text-center">PORNBLOCK</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-700 hover:bg-brand-900 text-white rounded-lg py-2 text-sm font-semibold transition-colors disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
