import { DeviceInfo } from '../types';

export function getOrCreateDeviceId(): string {
  const STORAGE_KEY = 'lanbridge_device_id';
  let deviceId = localStorage.getItem(STORAGE_KEY);
  if (!deviceId) {
    deviceId = 'dev_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
    localStorage.setItem(STORAGE_KEY, deviceId);
  }
  return deviceId;
}

export function detectDeviceOS(): string {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'Android';
  if (/iPad|iPhone|iPod/.test(ua)) return 'iOS';
  if (/windows phone/i.test(ua)) return 'Windows Phone';
  if (/win/i.test(ua)) return 'Windows';
  if (/mac/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Unknown OS';
}

export function detectBrowser(): string {
  const ua = navigator.userAgent;
  if (/edg/i.test(ua)) return 'Edge';
  if (/chrome|crios/i.test(ua)) return 'Chrome';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) return 'Safari';
  if (/opr\//i.test(ua)) return 'Opera';
  return 'Browser';
}

export function detectDeviceType(): 'desktop' | 'phone' | 'tablet' | 'laptop' {
  const ua = navigator.userAgent;
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return 'tablet';
  }
  if (/Mobile|iP(hone|od)|Android|BlackBerry|IEMobile|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/i.test(ua)) {
    return 'phone';
  }
  return 'desktop';
}

export function getLocalDeviceName(): string {
  const STORAGE_KEY = 'lanbridge_device_name';
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && saved.trim()) return saved.trim();

  const type = detectDeviceType();
  const os = detectDeviceOS();
  const randNum = Math.floor(100 + Math.random() * 900);

  let defaultName = `${os} ${type === 'phone' ? 'Phone' : type === 'tablet' ? 'Tablet' : 'PC'} (${randNum})`;
  localStorage.setItem(STORAGE_KEY, defaultName);
  return defaultName;
}

export function setLocalDeviceName(name: string): void {
  localStorage.setItem('lanbridge_device_name', name.trim());
}

export function getLocalDeviceInfo(): DeviceInfo {
  return {
    device_id: getOrCreateDeviceId(),
    device_name: getLocalDeviceName(),
    device_type: detectDeviceType(),
    os: detectDeviceOS(),
    browser: detectBrowser(),
    online: true,
  };
}
