// Cache Status Indicator Component
// Shows whether data is cached, fresh, or from live API

import React from 'react';

interface CacheStatusIndicatorProps {
  isCached?: boolean;
  lastUpdated?: string;
  source?: string;
  className?: string;
  showText?: boolean;
}

const CacheStatusIndicator: React.FC<CacheStatusIndicatorProps> = ({
  isCached = false,
  lastUpdated,
  source,
  className = '',
  showText = true
}) => {
  const getStatus = () => {
    if (isCached) {
      const isRecent = lastUpdated ? isDataFresh(lastUpdated, 5) : false;
      return {
        icon: '⚡',
        color: isRecent ? '#10b981' : '#f59e0b',
        text: isRecent ? 'Cached (Fresh)' : 'Cached',
        bgColor: isRecent ? '#ecfdf5' : '#fffbeb',
        borderColor: isRecent ? '#10b981' : '#f59e0b'
      };
    }
    
    return {
      icon: '🔄',
      color: '#3b82f6',
      text: 'Live API',
      bgColor: '#eff6ff',
      borderColor: '#3b82f6'
    };
  };

  const isDataFresh = (lastUpdated: string, maxAgeMinutes: number = 5): boolean => {
    const lastUpdate = new Date(lastUpdated);
    const now = new Date();
    const ageMinutes = (now.getTime() - lastUpdate.getTime()) / (1000 * 60);
    return ageMinutes <= maxAgeMinutes;
  };

  const getTimeAgo = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const status = getStatus();

  return (
    <div 
      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${className}`}
      style={{
        backgroundColor: status.bgColor,
        borderColor: status.borderColor,
        color: status.color
      }}
      title={`${status.text}${source ? ` • Source: ${source}` : ''}${lastUpdated ? ` • Updated: ${getTimeAgo(lastUpdated)}` : ''}`}
    >
      <span className="mr-1">{status.icon}</span>
      {showText && (
        <span>
          {status.text}
          {lastUpdated && (
            <span className="ml-1 opacity-75">
              ({getTimeAgo(lastUpdated)})
            </span>
          )}
        </span>
      )}
    </div>
  );
};

export default CacheStatusIndicator;