import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'paper' | 'light' | 'dark'
const STORAGE_KEY = 'penny:theme'

const Ctx = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({
  theme: 'paper',
  setTheme: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved === 'light' || saved === 'dark' || saved === 'paper' ? saved : 'paper'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>
}

export const useTheme = () => useContext(Ctx)

/** Recharts needs concrete colors (SVG attrs can't use var()) — resolve per theme. */
export function useChartColors() {
  const { theme } = useTheme()
  if (theme === 'dark') {
    return { grid: '#2c3a35', tick: '#9fb3aa', tooltipBg: '#1d2724', tooltipBorder: '#2c3a35', tooltipText: '#e6efe9' }
  }
  return { grid: '#e7e0d4', tick: '#5c6f68', tooltipBg: '#ffffff', tooltipBorder: '#e7e0d4', tooltipText: '#243430' }
}
