import { useState, useEffect, useCallback, useRef } from 'react';
import { ChatMessage, DeviceInfo } from '../types';
import { wsClient } from '../services/websocket';

function playNotificationChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // AudioContext blocked by user gesture policy or unsupported
  }
}

export function useChat(
  localDevice: DeviceInfo,
  isChatActive: boolean,
  onNotify?: (title: string, body?: string) => void
) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = sessionStorage.getItem('lanbridge_chat_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [selectedTargetId, setSelectedTargetId] = useState<string>('all');
  const isChatActiveRef = useRef(isChatActive);

  useEffect(() => {
    isChatActiveRef.current = isChatActive;
    if (isChatActive) {
      setUnreadCount(0);
    }
  }, [isChatActive]);

  // Persist recent messages in sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem('lanbridge_chat_history', JSON.stringify(messages.slice(-100)));
    } catch {}
  }, [messages]);

  useEffect(() => {
    const unsub = wsClient.on('chat_message', (payload: any) => {
      const msgData = payload.message || payload;
      if (!msgData || !msgData.text) return;
      if (msgData.sender_id === localDevice.device_id) return;

      const newMsg: ChatMessage = {
        id: msgData.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        sender_id: msgData.sender_id,
        sender_name: msgData.sender_name || 'Nearby Device',
        sender_type: msgData.sender_type,
        target_id: msgData.target_id || 'all',
        target_name: msgData.target_name,
        text: msgData.text,
        timestamp: msgData.timestamp || Date.now(),
        is_self: false,
      };

      setMessages((prev) => [...prev, newMsg]);

      if (!isChatActiveRef.current) {
        setUnreadCount((c) => c + 1);
        playNotificationChime();
        if (onNotify) {
          onNotify(newMsg.sender_name, newMsg.text.length > 60 ? `${newMsg.text.slice(0, 60)}...` : newMsg.text);
        }
      }
    });

    return () => {
      unsub();
    };
  }, [localDevice.device_id, onNotify]);

  const sendMessage = useCallback(
    (text: string, targetId: string = 'all', targetName?: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const newMsg: ChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        sender_id: localDevice.device_id,
        sender_name: localDevice.device_name,
        sender_type: localDevice.device_type,
        target_id: targetId,
        target_name: targetName,
        text: trimmed,
        timestamp: Date.now(),
        is_self: true,
      };

      // Add to local chat list
      setMessages((prev) => [...prev, newMsg]);

      // Transmit over WebSocket
      wsClient.send({
        type: 'chat_message',
        target_device_id: targetId === 'all' ? null : targetId,
        message: newMsg,
      });
    },
    [localDevice]
  );

  const markAsRead = useCallback(() => {
    setUnreadCount(0);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    try {
      sessionStorage.removeItem('lanbridge_chat_history');
    } catch {}
  }, []);

  return {
    messages,
    unreadCount,
    selectedTargetId,
    setSelectedTargetId,
    sendMessage,
    markAsRead,
    clearMessages,
  };
}
