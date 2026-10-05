import { useState, useEffect } from 'react';

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    if ('Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  const requestPermission = async (): Promise<boolean> => {
    if (!('Notification' in window)) return false;
    try {
      const res = await Notification.requestPermission();
      setPermission(res);
      return res === 'granted';
    } catch {
      return false;
    }
  };

  const notify = (title: string, options?: NotificationOptions) => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      try {
        new Notification(title, {
          icon: '/logo.svg',
          badge: '/logo.svg',
          ...options,
        });
      } catch {
        // Fallback
      }
    }
  };

  return { permission, requestPermission, notify };
}
