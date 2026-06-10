import { Coffee, Moon, Sun } from 'lucide-react'
import { useTheme, type Theme } from '../lib/theme'

const OPTIONS: { key: Theme; icon: React.ReactNode; label: string }[] = [
  { key: 'paper', icon: <Coffee className="h-3.5 w-3.5" />, label: 'Paper — warm and cozy' },
  { key: 'light', icon: <Sun className="h-3.5 w-3.5" />, label: 'Light — crisp and neutral' },
  { key: 'dark', icon: <Moon className="h-3.5 w-3.5" />, label: 'Dark — easy on the eyes' },
]

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme()
  return (
    <div className="flex gap-0.5 bg-stone-100 rounded-full p-0.5" role="radiogroup" aria-label="Color theme">
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          role="radio"
          aria-checked={theme === o.key}
          title={o.label}
          aria-label={o.label}
          className={`rounded-full p-1.5 transition-colors cursor-pointer ${
            theme === o.key ? 'bg-card text-brand-700 shadow-sm' : 'text-ink-soft hover:text-ink'
          }`}
          onClick={() => setTheme(o.key)}
        >
          {o.icon}
        </button>
      ))}
    </div>
  )
}
