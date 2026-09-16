import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { getSocket, type EntityChange } from '../lib/socket'

/**
 * Fetch + live refetch. Listens to entity:changed events from the socket and
 * refetches when a relevant entity mutates. When the change came from the
 * agent, the changed id is "highlighted" for a few seconds so the UI can glow
 * — that's the "Penny did this" moment.
 */
const REFETCH_DEBOUNCE_MS = 120

export function useLiveData<T>(path: string, entities: string[]) {
  const [data, setData] = useState<T | null>(null)
  const [highlights, setHighlights] = useState<Set<string>>(new Set())
  const entitiesRef = useRef(entities)
  useEffect(() => {
    entitiesRef.current = entities
  })

  const refetch = useCallback(() => {
    api<T>(path)
      .then(setData)
      .catch(() => {})
  }, [path])

  useEffect(() => {
    refetch()
  }, [refetch])

  useEffect(() => {
    const socket = getSocket()
    // one timer per highlighted id: a fresh change on the same id must RESET its
    // 3s window, not let an earlier timer cut the glow short.
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    let refetchTimer: ReturnType<typeof setTimeout> | null = null
    const onChange = (change: EntityChange) => {
      if (!entitiesRef.current.includes(change.entity)) return
      if (refetchTimer) clearTimeout(refetchTimer)
      refetchTimer = setTimeout(refetch, REFETCH_DEBOUNCE_MS)
      if (change.actor === 'agent' && change.id) {
        const id = String(change.id)
        setHighlights((prev) => new Set(prev).add(id))
        const existing = timers.get(id)
        if (existing) clearTimeout(existing)
        timers.set(
          id,
          setTimeout(() => {
            timers.delete(id)
            setHighlights((prev) => {
              const next = new Set(prev)
              next.delete(id)
              return next
            })
          }, 3000)
        )
      }
    }
    socket.on('entity:changed', onChange)
    return () => {
      socket.off('entity:changed', onChange)
      if (refetchTimer) clearTimeout(refetchTimer)
      timers.forEach(clearTimeout) // don't fire setState after unmount
    }
  }, [refetch])

  return { data, refetch, highlights }
}
