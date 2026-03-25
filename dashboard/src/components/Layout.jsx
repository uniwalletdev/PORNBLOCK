import { Outlet, NavLink } from "react-router-dom";
import { useClerk } from "@clerk/react";

const NAV = [
  { to: "/",           label: "Dashboard"  },
  { to: "/devices",    label: "Devices"    },
  { to: "/violations", label: "Violations" },
  { to: "/blocklist",  label: "Blocklist"  },
  { to: "/enrol",      label: "Enrol"      },
];

export default function Layout() {
  const { signOut } = useClerk();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-56 bg-brand-700 text-white flex flex-col shrink-0">
        <div className="px-6 py-5 text-xl font-bold tracking-wide border-b border-brand-900">
          PORNBLOCK
        </div>
        <nav className="flex-1 py-4 space-y-1 px-3">
          {NAV.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-lg text-sm font-medium transition-colors ` +
                (isActive
                  ? "bg-brand-900 text-white"
                  : "text-brand-100 hover:bg-brand-500 hover:text-white")
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={() => signOut()}
          className="m-3 py-2 text-sm text-brand-200 hover:text-white transition-colors"
        >
          Sign out
        </button>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto bg-gray-50 p-8">
        <Outlet />
      </main>
    </div>
  );
}

