import { useState, type FormEvent } from 'react';
import { useLogin } from '../hooks/queries';
import { ErrorNote } from '../components/ui';

export function LoginPage(): React.ReactElement {
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function submit(event: FormEvent): void {
    event.preventDefault();
    login.mutate({ email, password });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm px-6 py-7">
        <div className="mb-6 text-center">
          <p className="font-serif text-2xl text-moss-900">Lead Engine</p>
          <p className="mt-1 text-xs uppercase tracking-widest text-ink-faint">
            Makhana wholesale &amp; white-label
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {login.isError && <ErrorNote error={login.error} />}

          <button type="submit" className="btn-primary w-full" disabled={login.isPending}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
