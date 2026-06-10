import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { ActivityEvent, Artifact, ChatMessage, InterruptAction } from '../lib/types'

export interface StreamingMessage {
  content: string
  events: ActivityEvent[]
  artifacts: Artifact[]
  interrupt: { actions: InterruptAction[]; status: 'pending' } | null
}

const emptyStreaming = (): StreamingMessage => ({ content: '', events: [], artifacts: [], interrupt: null })

/** Reads our SSE protocol from a fetch body (EventSource can't POST). */
async function readSse(
  res: Response,
  onEvent: (event: string, data: any) => void
): Promise<void> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const lines = frame.split('\n')
      const eventLine = lines.find((l) => l.startsWith('event: '))
      const dataLine = lines.find((l) => l.startsWith('data: '))
      if (!eventLine || !dataLine) continue
      try {
        onEvent(eventLine.slice(7).trim(), JSON.parse(dataLine.slice(6)))
      } catch {
        /* skip malformed frame */
      }
    }
  }
}

export function useChatStream(sessionId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState<StreamingMessage | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const sessionRef = useRef(sessionId)
  useEffect(() => {
    sessionRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    setMessages([])
    setStreaming(null)
    if (!sessionId) return
    setLoadingHistory(true)
    api<{ messages: ChatMessage[] }>(`/api/chat/sessions/${sessionId}/messages`)
      .then((d) => setMessages(d.messages))
      .catch(() => {})
      .finally(() => setLoadingHistory(false))
  }, [sessionId])

  const runStream = useCallback(
    async (url: string, body: unknown) => {
      const startedFor = sessionRef.current
      setBusy(true)
      setStreaming(emptyStreaming())
      const acc = emptyStreaming()
      try {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => null)
          throw new Error(err?.error || 'Penny could not be reached')
        }
        let savedId: string | null = null
        await readSse(res, (event, data) => {
          if (sessionRef.current !== startedFor) return
          if (event === 'token') acc.content += data.text || ''
          else if (event === 'activity') {
            const existing = acc.events.find((e) => e.id === data.id)
            if (existing) Object.assign(existing, data)
            else acc.events.push(data)
          } else if (event === 'artifact') acc.artifacts.push(data)
          else if (event === 'interrupt') acc.interrupt = { actions: data.actions || [], status: 'pending' }
          else if (event === 'error' && !acc.content) acc.content = data.message || 'Something went wrong.'
          else if (event === 'done') savedId = data.messageId || null
          setStreaming({ ...acc, events: [...acc.events], artifacts: [...acc.artifacts] })
        })
        if (sessionRef.current === startedFor) {
          const finalized: ChatMessage = {
            _id: savedId || `local-${Date.now()}`,
            role: 'assistant',
            content: acc.content,
            events: acc.events,
            artifacts: acc.artifacts,
            interrupt: acc.interrupt ? { ...acc.interrupt } : undefined,
            createdAt: new Date().toISOString(),
          }
          setMessages((prev) => [...prev, finalized])
        }
      } catch (err: any) {
        if (sessionRef.current === startedFor) {
          setMessages((prev) => [
            ...prev,
            {
              _id: `local-err-${Date.now()}`,
              role: 'assistant',
              content: err?.message || 'Penny could not be reached. Please try again.',
              events: [],
              artifacts: [],
              createdAt: new Date().toISOString(),
            },
          ])
        }
      } finally {
        if (sessionRef.current === startedFor) {
          setStreaming(null)
          setBusy(false)
        }
      }
    },
    []
  )

  const send = useCallback(
    async (content: string) => {
      if (!sessionRef.current || !content.trim()) return
      setMessages((prev) => [
        ...prev,
        {
          _id: `local-u-${Date.now()}`,
          role: 'user',
          content: content.trim(),
          events: [],
          artifacts: [],
          createdAt: new Date().toISOString(),
        },
      ])
      await runStream(`/api/chat/sessions/${sessionRef.current}/messages`, { content })
    },
    [runStream]
  )

  const resume = useCallback(
    async (messageId: string, decisions: any[]) => {
      if (!sessionRef.current) return
      // mark the card resolved locally so it can't be double-submitted
      setMessages((prev) =>
        prev.map((m) =>
          m._id === messageId && m.interrupt ? { ...m, interrupt: { ...m.interrupt, status: 'resolved' } } : m
        )
      )
      await runStream(`/api/chat/sessions/${sessionRef.current}/resume`, { messageId, decisions })
    },
    [runStream]
  )

  const uploadDocument = useCallback(async (file: File) => {
    if (!sessionRef.current) return
    setBusy(true)
    setMessages((prev) => [
      ...prev,
      {
        _id: `local-up-${Date.now()}`,
        role: 'user',
        content: `📎 Uploaded ${file.name}`,
        events: [],
        artifacts: [],
        createdAt: new Date().toISOString(),
      },
    ])
    setStreaming({ ...emptyStreaming(), events: [{ id: 'extract', label: `Reading ${file.name}…`, tool: 'extract_document', status: 'running' }] })
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/uploads/extract/${sessionRef.current}`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Upload failed')
      setMessages((prev) => [...prev, data.message])
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          _id: `local-err-${Date.now()}`,
          role: 'assistant',
          content: err?.message || "I couldn't read that file.",
          events: [],
          artifacts: [],
          createdAt: new Date().toISOString(),
        },
      ])
    } finally {
      setStreaming(null)
      setBusy(false)
    }
  }, [])

  const patchMessageArtifact = useCallback((messageId: string, artifactIndex: number, patch: Record<string, any>) => {
    setMessages((prev) =>
      prev.map((m) =>
        m._id === messageId
          ? {
              ...m,
              artifacts: m.artifacts.map((a, i) => (i === artifactIndex ? { ...a, data: { ...a.data, ...patch } } : a)),
            }
          : m
      )
    )
  }, [])

  return { messages, streaming, busy, loadingHistory, send, resume, uploadDocument, patchMessageArtifact }
}
