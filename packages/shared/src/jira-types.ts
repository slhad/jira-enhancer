export interface AdfNode {
  type: string;
  content?: AdfNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface AdfDocument {
  version: 1;
  type: 'doc';
  content: AdfNode[];
}

export interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    description: AdfDocument | null;
    status: { name: string };
    issuetype: { name: string };
    [key: string]: unknown;
  };
}
