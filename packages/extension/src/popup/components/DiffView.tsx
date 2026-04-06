import React from 'react';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';

interface DiffViewProps {
  original: string;
  refined: string;
}

const darkTheme = {
  variables: {
    dark: {
      diffViewerBackground: '#1B2638',
      diffViewerColor: '#B0BEC5',
      addedBackground: '#1a3a2a',
      addedColor: '#a5d6a7',
      removedBackground: '#3a1a1a',
      removedColor: '#ef9a9a',
      wordAddedBackground: '#2e7d32',
      wordRemovedBackground: '#c62828',
      addedGutterBackground: '#1a3a2a',
      removedGutterBackground: '#3a1a1a',
      gutterBackground: '#172B4D',
      gutterBackgroundDark: '#0e1c30',
      highlightBackground: '#263859',
      highlightGutterBackground: '#1e3050',
      codeFoldGutterBackground: '#21364b',
      codeFoldBackground: '#172B4D',
      emptyLineBackground: '#1B2638',
      gutterColor: '#546E7A',
      addedGutterColor: '#66bb6a',
      removedGutterColor: '#ef5350',
      codeFoldContentColor: '#78909C',
    },
  },
};

export function DiffView({ original, refined }: DiffViewProps) {
  return (
    <div className="diff-view">
      <div className="diff-header">
        <span className="diff-label diff-label-original">Original</span>
        <span className="diff-label diff-label-refined">Refined</span>
      </div>
      <div className="diff-content">
        <ReactDiffViewer
          oldValue={original}
          newValue={refined}
          splitView={true}
          useDarkTheme={true}
          compareMethod={DiffMethod.WORDS}
          styles={darkTheme}
          leftTitle=""
          rightTitle=""
        />
      </div>
    </div>
  );
}
