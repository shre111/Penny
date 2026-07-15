import { useCallback, useEffect, useRef, useState } from 'react'
import { LayoutDashboard, LogOut, MessageCircle } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { onAskPenny } from '../lib/askPenny'
import { Wordmark } from '../components/ui'
import { ThemeSwitch } from '../components/ThemeSwitch'
import { Dashboard } from '../components/dashboard/Dashboard'
import { ChatPanel } from '../components/chat/ChatPanel'

const CHAT_WIDTH_KEY = 'penny:chatWidth'
const CHAT_WIDTH_DEFAULT = 440
const CHAT_WIDTH_MIN = 340
const chatWidthMax = () => Math.min(820, Math.round(window.innerWidth * 0.6))

/**
 * The whole point of Penny, in one screen: your business on the left,
 * your assistant on the right — and the left side moves when she works.
 * The divider drags (double-click resets); on small screens the two become tabs.
 */
export default function AppShell() {
  const { user, logout } = useAuth()
  const [mobileView, setMobileView] = useState<'dashboard' | 'chat'>('chat')
  const [chatWidth, setChatWidth] = useState(() => {
    const saved = Number(localStorage.getItem(CHAT_WIDTH_KEY))
    // clamp a restored width to the current viewport's max — a value saved on a
    // wider window would otherwise overflow the panel on a narrower one.
    return saved >= CHAT_WIDTH_MIN ? Math.min(saved, chatWidthMax()) : CHAT_WIDTH_DEFAULT
  })
  const [dragging, setDragging] = useState(false)
  const widthRef = useRef(chatWidth)
  useEffect(() => {
    widthRef.current = chatWidth
  }, [chatWidth])

  // a dashboard "Ask Penny" tap should reveal the chat on small screens
  useEffect(() => onAskPenny(() => setMobileView('chat')), [])

  const startDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    setDragging(true)
    const startX = e.clientX
    const startW = widthRef.current
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    const onMove = (ev: PointerEvent) => {
      const next = Math.min(chatWidthMax(), Math.max(CHAT_WIDTH_MIN, startW + (startX - ev.clientX)))
      setChatWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      setDragging(false)
      localStorage.setItem(CHAT_WIDTH_KEY, String(widthRef.current))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }, [])

  const resetWidth = () => {
    setChatWidth(CHAT_WIDTH_DEFAULT)
    localStorage.setItem(CHAT_WIDTH_KEY, String(CHAT_WIDTH_DEFAULT))
  }

  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center justify-between px-4 sm:px-6 py-2.5 bg-card border-b border-line shrink-0">
        <Wordmark size="text-xl" />
        <div className="flex items-center gap-3">
          <ThemeSwitch />
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
        {/* chat — fixed width on desktop, draggable via the divider */}
        <aside
          className={`relative w-full shrink-0 min-h-0 lg:w-(--chat-w) ${mobileView === 'chat' ? 'block' : 'hidden'} lg:block`}
          style={{ '--chat-w': `${chatWidth}px` } as React.CSSProperties}
        >
          <div
            className={`hidden lg:block absolute inset-y-0 -left-1 w-2 z-20 cursor-col-resize group ${dragging ? 'bg-brand-400/40' : ''}`}
            onPointerDown={startDrag}
            onDoubleClick={resetWidth}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize chat panel (drag, double-click to reset)"
            title="Drag to resize · double-click to reset"
          >
            <span className="absolute inset-y-0 left-1 w-px bg-transparent group-hover:bg-brand-400 transition-colors" />
          </div>
          <ChatPanel />
        </aside>
      </div>

      {/* mobile tab bar */}
      <nav className="lg:hidden flex border-t border-line bg-card shrink-0" aria-label="Switch view">
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
