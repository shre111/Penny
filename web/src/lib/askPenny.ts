// Tiny event bus: dashboard elements prefill the chat composer.
// Control flows BOTH ways — chat drives the dashboard, dashboard drives the chat.

const EVENT = 'penny:ask'

export function askPenny(text: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: text }))
}

export function onAskPenny(handler: (text: string) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<string>).detail)
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
