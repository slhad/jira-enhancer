import React from 'react';

interface LoadingStateProps {
  status: string;
  progress?: number;
}

const statusLabels: Record<string, string> = {
  processing: 'Processing request…',
  exploring: 'Exploring codebase…',
  refining: 'Refining description…',
};

export function LoadingState({ status, progress }: LoadingStateProps) {
  const label = statusLabels[status] ?? status;

  return (
    <div className="loading-state">
      <div className="spinner" />
      <span className="loading-status-text">{label}</span>
      {progress !== undefined && (
        <div className="progress-bar-track">
          <div
            className="progress-bar-fill"
            style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
