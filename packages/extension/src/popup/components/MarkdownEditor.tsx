import React from 'react';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function MarkdownEditor({ value, onChange }: MarkdownEditorProps) {
  return (
    <div className="markdown-editor">
      <label className="field-label" htmlFor="markdown-textarea">
        Edit Description
      </label>
      <textarea
        id="markdown-textarea"
        className="markdown-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={true}
      />
    </div>
  );
}
