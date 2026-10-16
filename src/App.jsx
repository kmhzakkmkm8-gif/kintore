import { useEffect, useState } from 'react';
import { isFirebaseConfigured, login, watchAuth } from './lib/backend.js';
import { DataProvider, useData } from './lib/store.jsx';
import Home from './pages/Home.jsx';
import Workout from './pages/Workout.jsx';
import Nutrition from './pages/Nutrition.jsx';
import Progress from './pages/Progress.jsx';
import Settings from './pages/Settings.jsx';

const TABS = [
  { path: '/', label: 'ホーム', icon: '🏠' },
  { path: '/workout', label: 'トレーニング', icon: '🏋️' },
  { path: '/food', label: '食事', icon: '🍚' },
  { path: '/progress', label: '進捗', icon: '📈' },
  { path: '/settings', label: '設定', icon: '⚙️' },
];

function useRoute() {
  const get = () => window.location.hash.replace(/^#/, '') || '/';
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => {
      setRoute(get());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

function Shell() {
  const data = useData();
  const route = useRoute();

  if (!data.ready) {
    return <div className="min-h-screen grid place-items-center text-slate-400">読み込み中…</div>;
  }

  const Page = { '/': Home, '/workout': Workout, '/food': Nutrition, '/progress': Progress, '/settings': Settings }[route] || Home;

  return (
    <div className="min-h-screen pb-24">
      <main className="max-w-xl mx-auto px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Page />
      </main>
      <nav className="fixed bottom-0 inset-x-0 z-40 bg-slate-950/95 backdrop-blur border-t border-slate-800 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-xl mx-auto grid grid-cols-5">
          {TABS.map((t) => (
            <a
              key={t.path}
              href={`#${t.path}`}
              className={`flex flex-col items-center py-2 text-[11px] ${route === t.path ? 'text-emerald-400' : 'text-slate-400'}`}
            >
              <span className="text-xl leading-none mb-0.5">{t.icon}</span>
              {t.label}
            </a>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Login() {
  const [err, setErr] = useState(null);
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-bold">筋トレ記録</h1>
        <p className="text-slate-400 text-sm">Googleアカウントでログインすると、記録がクラウドに保存されます。</p>
        <button
          type="button"
          className="rounded-xl bg-emerald-500 text-slate-950 font-bold px-6 py-3"
          onClick={() => login().catch((e) => setErr(e.message))}
        >
          Googleでログイン
        </button>
        {err && <p className="text-rose-400 text-sm">{err}</p>}
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);
  useEffect(() => watchAuth(setUser), []);

  if (user === undefined) return <div className="min-h-screen grid place-items-center text-slate-400">…</div>;
  if (!user && isFirebaseConfigured) return <Login />;
  return (
    <DataProvider uid={user.uid} key={user.uid}>
      <Shell />
    </DataProvider>
  );
}
