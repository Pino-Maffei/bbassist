import React from 'react';
import { Role } from '../types';
import { GroundingChunk } from '@google/genai';

interface ChatBubbleProps {
  role: Role;
  text: string;
  isInterim?: boolean;
  groundingChunks?: GroundingChunk[];
}

const ChatBubble: React.FC<ChatBubbleProps> = ({ role, text, isInterim = false, groundingChunks }) => {
  const isUser = role === Role.USER;

  const bubbleClasses = isUser
    ? 'bg-blue-600/80 self-end'
    : 'bg-slate-700/60 self-start';
  
  const interimClasses = isInterim ? 'opacity-60 italic' : '';

  const renderGroundingChunks = () => {
    if (!groundingChunks || groundingChunks.length === 0) {
      return null;
    }

    const validChunks = groundingChunks.filter(chunk => chunk.maps || chunk.web);

    if (validChunks.length === 0) {
      return null;
    }

    return (
      <div className="mt-3 pt-3 border-t border-slate-600">
        <h4 className="text-xs font-semibold text-slate-400 mb-1">Sources:</h4>
        <ul className="space-y-1">
          {validChunks.map((chunk, index) => {
            const uri = chunk.maps?.uri || chunk.web?.uri;
            const title = chunk.maps?.title || chunk.web?.title || uri;

            if (!uri) {
              return null;
            }

            return (
              <li key={index}>
                <a
                  href={uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-400 hover:text-blue-300 hover:underline"
                >
                  {title}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-md md:max-w-lg lg:max-w-3xl px-4 py-3 rounded-xl text-slate-100 shadow-md ${bubbleClasses} ${interimClasses}`}
      >
        <p className="whitespace-pre-wrap">{text}</p>
        {renderGroundingChunks()}
      </div>
    </div>
  );
};

export default ChatBubble;
