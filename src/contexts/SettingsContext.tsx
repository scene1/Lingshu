import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'

interface GeneralSettings {
  language?: string
  theme?: string
  fontSize?: number
  startup?: string
  autoScroll?: boolean
}

interface SettingsContextType {
  appTheme: 'light' | 'dark'
  fontSize: number
  locale: typeof zhCN
  updateSettings: (general: GeneralSettings) => void
}

const SettingsContext = createContext<SettingsContextType>({
  appTheme: 'light',
  fontSize: 14,
  locale: zhCN,
  updateSettings: () => {}
})

export const useSettings = () => useContext(SettingsContext)

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeSetting, setThemeSetting] = useState<string>('light')
  const [appTheme, setAppTheme] = useState<'light' | 'dark'>('light')
  const [fontSize, setFontSize] = useState<number>(14)
  const [locale, setLocale] = useState(zhCN)

  function resolveTheme(themeStr: string): 'light' | 'dark' {
    if (themeStr === 'dark') return 'dark'
    if (themeStr === 'light') return 'light'
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'light'
  }

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const handler = (e: MediaQueryListEvent) => {
      if (themeSetting === 'system') {
        setAppTheme(e.matches ? 'dark' : 'light')
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [themeSetting])

  const updateSettings = useCallback((general: GeneralSettings) => {
    if (general.theme) {
      setThemeSetting(general.theme)
      setAppTheme(resolveTheme(general.theme))
    }
    if (general.language) setLocale(general.language === 'en' ? enUS : zhCN)
    if (general.fontSize) setFontSize(general.fontSize)
  }, [])

  return (
    <SettingsContext.Provider value={{ appTheme, fontSize, locale, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  )
}

export default SettingsContext
