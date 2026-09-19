function safeStore(resolve: () => Storage) {
  return {
    get(key: string): string | null {
      try {
        return resolve().getItem(key)
      } catch {
        return null
      }
    },
    set(key: string, value: string): void {
      try {
        resolve().setItem(key, value)
      } catch {
        /* storage blocked or full — the preference just doesn't persist */
      }
    },
  }
}

export const localStore = safeStore(() => localStorage)
export const sessionStore = safeStore(() => sessionStorage)
