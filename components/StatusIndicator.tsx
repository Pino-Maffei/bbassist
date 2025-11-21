import React from 'react';
import { ConnectionState } from '../types';

interface StatusIndicatorProps {
  state: ConnectionState;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ state }) => {
  const getStatus = (): { text: string; color: string; pulse: boolean } => {
    switch (state) {
      case ConnectionState.CONNECTED:
        return { text: 'Connected & Listening', color: 'bg-green-500', pulse: true };
      case ConnectionState.CONNECTING:
        return { text: 'Connecting...', color: 'bg-yellow-500', pulse: true };
      case ConnectionState.DISCONNECTED:
        return { text: 'Disconnected', color: 'bg-gray-500', pulse: false };
      case ConnectionState.ERROR:
        return { text: 'Error', color: 'bg-red-500', pulse: false };
      default:
        return { text: 'Unknown', color: 'bg-gray-500', pulse: false };
    }
  };

  const { text, color, pulse } = getStatus();

  return (
    <div className="flex items-center space-x-2">
      <div className={`w-3 h-3 rounded-full ${color} ${pulse ? 'animate-pulse' : ''}`}></div>
      <span className="text-sm text-gray-400">{text}</span>
    </div>
  );
};

export default StatusIndicator;