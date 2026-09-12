'use client'

import { useEffect } from 'react'

const CLEANUP_MARKER = 'voxflame:legacy-pwa-cleanup:v1'

/**
 * Removes the old Web App runtime once per browser profile.
 * Recorder queue data lives in IndexedDB and is intentionally left untouched.
 */
export function LegacyPwaCleanup() {
  useEffect(() => {
    if (typeof window === 'undefined' || window.localStorage.getItem(CLEANUP_MARKER) === '1') {
      return
    }

    const cleanup = async () => {
      const registrations = 'serviceWorker' in navigator
        ? await navigator.serviceWorker.getRegistrations()
        : []
      const cacheNames = 'caches' in window ? await caches.keys() : []
      const hadLegacyRuntime = registrations.length > 0 || cacheNames.length > 0

      await Promise.all(registrations.map((registration) => registration.unregister()))
      await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)))

      if (hadLegacyRuntime) {
        window.location.reload()
      } else {
        window.localStorage.setItem(CLEANUP_MARKER, '1')
      }
    }

    void cleanup()
      .then(() => window.localStorage.setItem(CLEANUP_MARKER, '1'))
      .catch((error) => {
        console.error('[LegacyPwaCleanup] Failed to clear old Web App runtime:', error)
      })
  }, [])

  return null
}

export default LegacyPwaCleanup
