import { DeviceInfo } from '../types';

type MessageHandler = (data: any) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<MessageHandler>> = new Map();
  private reconnectTimer: any = null;
  private pingInterval: any = null;
  private deviceInfo: DeviceInfo | null = null;
  public isConnected: boolean = false;

  public connect(device: DeviceInfo): void {
    this.deviceInfo = device;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const query = new URLSearchParams({
      device_id: device.device_id,
      device_name: device.device_name,
      device_type: device.device_type,
      os: device.os,
      browser: device.browser,
    });

    const url = `${protocol}//${host}/ws?${query.toString()}`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.emit('connection_changed', { connected: true });
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        if (event.data === 'pong') return;
        try {
          const message = JSON.parse(event.data);
          if (message.type) {
            this.emit(message.type, message);
          }
        } catch {
          // Non-JSON message
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.emit('connection_changed', { connected: false });
        this.stopHeartbeat();
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.isConnected = false;
        this.ws?.close();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('ping');
      }
    }, 15000);
  }

  private stopHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.deviceInfo) {
        this.connect(this.deviceInfo);
      }
    }, 3000);
  }

  public on(eventType: string, handler: MessageHandler): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(handler);
    return () => {
      this.listeners.get(eventType)?.delete(handler);
    };
  }

  private emit(eventType: string, data: any): void {
    const handlers = this.listeners.get(eventType);
    if (handlers) {
      handlers.forEach((h) => h(data));
    }
  }

  public disconnect(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}

export const wsClient = new WebSocketClient();
