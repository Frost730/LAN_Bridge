import { useState, useEffect, useCallback, useRef } from 'react';

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const recentNotificationsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if ('Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!('Notification' in window)) return false;
    try {
      const res = await Notification.requestPermission();
      setPermission(res);
      return res === 'granted';
    } catch {
      return false;
    }
  }, []);

  const notify = useCallback((title: string, options?: NotificationOptions) => {
    if (!('Notification' in window)) return;

    // Check user preference in localStorage (default is enabled)
    try {
      const enabled = localStorage.getItem('lanbridge_notifications');
      if (enabled === 'false') return;
    } catch {
      // Ignore localStorage errors
    }

    // Deduplication & throttling: suppress identical notifications within 3.5 seconds
    const bodyText = options?.body || '';
    const dedupeKey = `${title}:::${bodyText}`;
    const now = Date.now();
    const lastSent = recentNotificationsRef.current.get(dedupeKey);
    if (lastSent && now - lastSent < 3500) {
      return;
    }
    recentNotificationsRef.current.set(dedupeKey, now);

    // Prune stale deduplication entries periodically
    if (recentNotificationsRef.current.size > 50) {
      for (const [key, timestamp] of recentNotificationsRef.current.entries()) {
        if (now - timestamp > 10000) {
          recentNotificationsRef.current.delete(key);
        }
      }
    }

    if (Notification.permission === 'granted') {
      const notificationOptions: NotificationOptions = {
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        silent: false,
        tag: options?.tag || 'lanbridge-notification',
        ...options,
      };
      (notificationOptions as Record<string, unknown>).vibrate = [150, 80, 150];

      // Service worker showNotification delivers reliably in background and on mobile devices
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready
          .then((registration) => {
            registration.showNotification(title, notificationOptions);
          })
          .catch(() => {
            try {
              new Notification(title, notificationOptions);
            } catch {
              // Ignore
            }
          });
      } else {
        try {
          new Notification(title, notificationOptions);
        } catch {
          // Fallback
        }
      }
    }
  }, []);

  return { permission, requestPermission, notify };
}
