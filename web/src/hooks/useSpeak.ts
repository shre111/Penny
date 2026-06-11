import { useEffect, useState } from 'react'

/** Penny reads things aloud (browser speechSynthesis — no API, no cost). */
export function useSpeak() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const [speaking, setSpeaking] = useState(false)

  useEffect(() => {
    return () => {
      if (supported) window.speechSynthesis.cancel()
    }
  }, [supported])

  const speak = (text: string, onEnd?: () => void) => {
    if (!supported) return
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1
    utterance.pitch = 1.05
    utterance.onend = () => {
      setSpeaking(false)
      onEnd?.()
    }
    utterance.onerror = () => {
      setSpeaking(false)
      onEnd?.()
    }
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
    setSpeaking(true)
  }

  const stop = () => {
    if (!supported) return
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }

  const toggle = (text: string) => {
    if (speaking) stop()
    else speak(text)
  }

  return { supported, speaking, toggle, speak, stop }
}
