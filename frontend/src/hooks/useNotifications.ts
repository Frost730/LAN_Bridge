import { useState, useEffect, useCallback } from 'react';

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>('default');

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
    if (Notification.permission === 'granted') {
      const notificationOptions: NotificationOptions = {
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        silent: false,
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
