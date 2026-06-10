import { useEffect, useRef, useState } from 'react'

/**
 * Voice input via the Web Speech API (Chrome/Safari/Edge). Returns interim
 * transcripts as the user talks — ideal for owners who'd rather speak than type.
 */
export function useSpeechInput(onTranscript: (text: string, isFinal: boolean) => void) {
  const Recognition =
    typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  const [listening, setListening] = useState(false)
  const recRef = useRef<any>(null)
  const cbRef = useRef(onTranscript)
  useEffect(() => {
    cbRef.current = onTranscript
  })

  useEffect(() => {
    return () => recRef.current?.abort?.()
  }, [])

  const toggle = () => {
    if (!Recognition) return
    if (listening) {
      recRef.current?.stop()
      return
    }
    const rec = new Recognition()
    rec.lang = navigator.language || 'en-US'
    rec.interimResults = true
    rec.continuous = false
    rec.onresult = (e: any) => {
      let text = ''
      let isFinal = false
      for (const result of e.results) {
        text += result[0].transcript
        if (result.isFinal) isFinal = true
      }
      cbRef.current(text.trim(), isFinal)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recRef.current = rec
    rec.start()
    setListening(true)
  }

  return { supported: Boolean(Recognition), listening, toggle }
}
