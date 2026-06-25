import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { getSocket, type EntityChange } from '../lib/socket'

/**
 * Fetch + live refetch. Listens to entity:changed events from the socket and
 * refetches when a relevant entity mutates. When the change came from the
 * agent, the changed id is "highlighted" for a few seconds so the UI can glow
 * — that's the "Penny did this" moment.
 */
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
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const onChange = (change: EntityChange) => {
      if (!entitiesRef.current.includes(change.entity)) return
      refetch()
      if (change.actor === 'agent' && change.id) {
        const id = String(change.id)
        setHighlights((prev) => new Set(prev).add(id))
        const t = setTimeout(() => {
          timers.delete(t)
          setHighlights((prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        }, 3000)
        timers.add(t)
      }
    }
    socket.on('entity:changed', onChange)
    return () => {
      socket.off('entity:changed', onChange)
      timers.forEach(clearTimeout) // don't fire setState after unmount
    }
  }, [refetch])

  return { data, refetch, highlights }
}
