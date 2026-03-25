import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import App from "./App.jsx";
import "./index.css";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Show a clear error page instead of a blank screen if the key is missing.
if (!PUBLISHABLE_KEY) {
  document.getElementById("root").innerHTML = `
    <div style="font-family:sans-serif;display:flex;flex-direction:column;
                align-items:center;justify-content:center;min-height:100vh;
                background:#fef2f2;color:#991b1b;padding:2rem;text-align:center">
      <h1 style="font-size:1.5rem;font-weight:700;margin-bottom:1rem">
        &#9888; Configuration Error
      </h1>
      <p style="max-width:480px;line-height:1.6">
        <strong>VITE_CLERK_PUBLISHABLE_KEY</strong> is not set.<br/>
        Add it in <strong>Vercel &rarr; Project Settings &rarr; Environment Variables</strong>,
        then redeploy.
      </p>
    </div>`;
  throw new Error("VITE_CLERK_PUBLISHABLE_KEY is not set — see the error screen");
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:   60_000,
      retry:       1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
      <QueryClientProvider client={queryClient}>
        <App />
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </ClerkProvider>
  </React.StrictMode>,
);
