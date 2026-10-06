import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  MessageSquare,
  Users,
  Smartphone,
  Tablet,
  Laptop,
  Monitor,
  Trash2,
  Copy,
  Check,
  Lock,
  Globe,
  CornerDownLeft,
} from 'lucide-react';
import { ChatMessage, DeviceInfo } from '../types';

interface ChatPageProps {
  localDevice: DeviceInfo;
  onlineDevices: DeviceInfo[];
  currentRoom: string | null;
  messages: ChatMessage[];
  selectedTargetId: string;
  onSelectTargetId: (id: string) => void;
  onSendMessage: (text: string, targetId: string, targetName?: string) => void;
  onClearMessages: () => void;
}

export const ChatPage: React.FC<ChatPageProps> = ({
  localDevice,
  onlineDevices,
  currentRoom,
  messages,
  selectedTargetId,
  onSelectTargetId,
  onSendMessage,
  onClearMessages,
}) => {
  const [inputText, setInputText] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;

    let targetName: string | undefined = undefined;
    if (selectedTargetId !== 'all') {
      const targetDevice = onlineDevices.find((d) => d.device_id === selectedTargetId);
      targetName = targetDevice?.device_name;
    }

    onSendMessage(trimmed, selectedTargetId, targetName);
    setInputText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const renderDeviceIcon = (type?: string) => {
    switch (type) {
      case 'phone':
        return <Smartphone className="w-3.5 h-3.5" />;
      case 'tablet':
        return <Tablet className="w-3.5 h-3.5" />;
      case 'laptop':
        return <Laptop className="w-3.5 h-3.5" />;
      default:
        return <Monitor className="w-3.5 h-3.5" />;
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const targetDevice = onlineDevices.find((d) => d.device_id === selectedTargetId);

  const quickChips = ['👋 Hello!', '📁 Ready for files', '🚀 Got the link', '👍 Thanks!'];

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] sm:h-[calc(100vh-160px)] max-w-4xl mx-auto bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden animate-in fade-in duration-300">
      {/* Chat Header & Target Selector */}
      <div className="p-3.5 sm:p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center space-x-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-brand-100 dark:bg-brand-950/80 text-brand-600 dark:text-brand-400 flex items-center justify-center shrink-0">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center space-x-1.5">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                {selectedTargetId === 'all'
                  ? currentRoom
                    ? `Room: ${currentRoom}`
                    : 'All Connected Devices'
                  : targetDevice?.device_name || 'Direct Chat'}
              </h2>
              {selectedTargetId === 'all' ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400">
                  <Globe className="w-3 h-3 mr-1" />
                  {onlineDevices.length} Online
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300">
                  <Lock className="w-3 h-3 mr-1" />
                  Direct
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {selectedTargetId === 'all'
                ? currentRoom
                  ? 'Messages visible only to participants in this temporary room'
                  : 'Broadcasts to peers sharing your local network'
                : `Private message to ${targetDevice?.device_name || 'selected peer'}`}
            </p>
          </div>
        </div>

        {/* Target Selector Dropdown & Clear History */}
        <div className="flex items-center space-x-2 ml-auto">
          <select
            value={selectedTargetId}
            onChange={(e) => onSelectTargetId(e.target.value)}
            className="text-xs font-medium py-1.5 px-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500 shadow-sm"
          >
            <option value="all">
              {currentRoom ? `Everyone in "${currentRoom}"` : `Everyone (${onlineDevices.length})`}
            </option>
            {onlineDevices.map((dev) => (
              <option key={dev.device_id} value={dev.device_id}>
                Direct: {dev.device_name}
              </option>
            ))}
          </select>

          {messages.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm('Clear all chat messages?')) {
                  onClearMessages();
                }
              }}
              className="p-1.5 text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Clear Chat History"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 p-3.5 sm:p-5 overflow-y-auto space-y-3.5">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
              <MessageSquare className="w-7 h-7 text-slate-400 dark:text-slate-500" />
            </div>
            <h3 className="font-bold text-sm text-slate-700 dark:text-slate-200 mb-1">
              No messages yet
            </h3>
            <p className="text-xs max-w-xs mb-5">
              Send a quick message, coordinate file transfers, or say hello to peers.
            </p>
            <div className="flex flex-wrap justify-center gap-1.5 max-w-sm">
              {quickChips.map((chip) => (
                <button
                  key={chip}
                  onClick={() => {
                    setInputText(chip);
                    textareaRef.current?.focus();
                  }}
                  className="px-2.5 py-1 text-xs font-medium rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isSelf = msg.is_self || msg.sender_id === localDevice.device_id;
            const isDirect = msg.target_id && msg.target_id !== 'all';

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'} group`}
              >
                {/* Sender Tag */}
                <div
                  className={`flex items-center space-x-1.5 text-[10px] text-slate-400 mb-1 px-1 ${
                    isSelf ? 'flex-row-reverse space-x-reverse' : ''
                  }`}
                >
                  {!isSelf && (
                    <span className="text-brand-500">
                      {renderDeviceIcon(msg.sender_type)}
                    </span>
                  )}
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {isSelf ? 'You' : msg.sender_name}
                  </span>
                  <span>•</span>
                  <span>{formatTime(msg.timestamp)}</span>
                  {isDirect && (
                    <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-medium bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300">
                      <Lock className="w-2.5 h-2.5 mr-0.5" />
                      Direct
                    </span>
                  )}
                </div>

                {/* Message Bubble */}
                <div className="flex items-center space-x-1.5 max-w-[85%] sm:max-w-[75%]">
                  {isSelf && (
                    <button
                      onClick={() => handleCopyText(msg.text, msg.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-opacity"
                      title="Copy text"
                    >
                      {copiedId === msg.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}

                  <div
                    className={`p-3 rounded-2xl text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm select-text ${
                      isSelf
                        ? 'bg-brand-600 text-white rounded-br-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-bl-sm border border-slate-200/60 dark:border-slate-700/60'
                    }`}
                  >
                    {msg.text}
                  </div>

                  {!isSelf && (
                    <button
                      onClick={() => handleCopyText(msg.text, msg.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-opacity"
                      title="Copy text"
                    >
                      {copiedId === msg.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
        <form onSubmit={handleSend} className="flex items-end gap-2">
          <div className="flex-1 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm focus-within:ring-2 focus-within:ring-brand-500 focus-within:border-transparent transition-all overflow-hidden flex items-center px-3 py-1.5">
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                selectedTargetId === 'all'
                  ? currentRoom
                    ? `Message room "${currentRoom}"...`
                    : 'Message all devices...'
                  : `Direct message to ${targetDevice?.device_name || 'peer'}...`
              }
              className="w-full bg-transparent resize-none text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none max-h-28 py-1"
            />
          </div>

          <button
            type="submit"
            disabled={!inputText.trim()}
            className="p-3 rounded-2xl bg-brand-600 hover:bg-brand-500 active:bg-brand-700 disabled:opacity-40 text-white shadow-md shadow-brand-500/25 transition-all flex items-center justify-center shrink-0 min-w-[44px] min-h-[44px]"
            title="Send Message (Enter)"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
        <div className="flex items-center justify-between mt-1.5 px-1 text-[10px] text-slate-400">
          <span>Press Enter to send, Shift+Enter for new line</span>
          <span>{inputText.length > 0 && `${inputText.length} chars`}</span>
        </div>
      </div>
    </div>
  );
};
