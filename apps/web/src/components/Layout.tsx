import { NavLink, Outlet } from 'react-router-dom';
import { useLogout, useMe } from '../hooks/queries';

const NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/leads', label: 'Leads' },
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/catalogue', label: 'Catalogue' },
];

export function Layout(): React.ReactElement {
  const me = useMe();
  const logout = useLogout();

  return (
    <div className="min-h-screen">
      <header className="border-b border-parchment-300 bg-moss-800 text-parchment-100">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-lg">Lead Engine</span>
            <span className="hidden text-[10px] uppercase tracking-widest text-moss-300 sm:inline">
              Makhana
            </span>
          </div>

          <nav className="flex flex-1 items-center gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-sm px-2.5 py-1 text-sm transition-colors ${
                    isActive
                      ? 'bg-moss-600 text-parchment-50'
                      : 'text-moss-200 hover:bg-moss-700 hover:text-parchment-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3 text-xs">
            <span className="hidden text-moss-300 md:inline">{me.data?.user.email}</span>
            <button
              type="button"
              onClick={() => logout.mutate()}
              className="rounded-sm border border-moss-600 px-2 py-1 text-moss-200 hover:bg-moss-700"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-5 py-6">
        <Outlet />
      </main>
    </div>
  );
}
