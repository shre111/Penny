import { useEffect, useState } from 'react'
import { LayoutDashboard, LogOut, MessageCircle } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { onAskPenny } from '../lib/askPenny'
import { Wordmark } from '../components/ui'
import { Dashboard } from '../components/dashboard/Dashboard'
import { ChatPanel } from '../components/chat/ChatPanel'

/**
 * The whole point of Penny, in one screen: your business on the left,
 * your assistant on the right — and the left side moves when she works.
 * On small screens the two become tabs.
 */
export default function AppShell() {
  const { user, logout } = useAuth()
  const [mobileView, setMobileView] = useState<'dashboard' | 'chat'>('chat')

  // a dashboard "Ask Penny" tap should reveal the chat on small screens
  useEffect(() => onAskPenny(() => setMobileView('chat')), [])

  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center justify-between px-4 sm:px-6 py-2.5 bg-white border-b border-line shrink-0">
        <Wordmark size="text-xl" />
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold leading-tight">{user?.businessName || user?.name}</p>
            <p className="text-[11px] text-ink-soft">{user?.email}</p>
          </div>
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-9 w-9 rounded-full border border-line" referrerPolicy="no-referrer" />
          ) : (
            <span className="h-9 w-9 rounded-full bg-brand-100 text-brand-800 font-bold inline-flex items-center justify-center">
              {(user?.name || '?').charAt(0).toUpperCase()}
            </span>
          )}
          <button className="btn-ghost text-xs py-1.5 px-3" onClick={logout}>
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        {/* dashboard */}
        <main
          className={`flex-1 min-w-0 overflow-y-auto p-4 sm:p-5 ${mobileView === 'dashboard' ? 'block' : 'hidden'} lg:block`}
        >
          <Dashboard />
        </main>
        {/* chat */}
        <aside
          className={`w-full lg:w-105 xl:w-120 shrink-0 min-h-0 ${mobileView === 'chat' ? 'block' : 'hidden'} lg:block`}
        >
          <ChatPanel />
        </aside>
      </div>

      {/* mobile tab bar */}
      <nav className="lg:hidden flex border-t border-line bg-white shrink-0" aria-label="Switch view">
        <button
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold cursor-pointer ${mobileView === 'dashboard' ? 'text-brand-700' : 'text-ink-soft'}`}
          onClick={() => setMobileView('dashboard')}
        >
          <LayoutDashboard className="h-4.5 w-4.5" /> My business
        </button>
        <button
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold cursor-pointer ${mobileView === 'chat' ? 'text-brand-700' : 'text-ink-soft'}`}
          onClick={() => setMobileView('chat')}
        >
          <MessageCircle className="h-4.5 w-4.5" /> Chat with Penny
        </button>
      </nav>
    </div>
  )
}
