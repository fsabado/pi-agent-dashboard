export interface SessionTreeHeader {
  type: "session";
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

export interface SessionTreeEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  [key: string]: unknown;
}

export type MessageBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "toolCall"; name: string; text: string }
  | { kind: "image"; text: string };

export interface EntryView {
  id: string;
  parentId: string | null;
  timestamp: string;
  type: string;
  role?: string;
  blocks: MessageBlock[];
}

export interface SessionTreeStats {
  userMessages: number;
  assistantMessages: number;
  toolResults: number;
  compactions: number;
  toolCalls: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  models: string[];
}

export interface SessionTreeView {
  file: string;
  id: string;
  cwd: string;
  createdAt: string;
  modifiedAt: string;
  stats: SessionTreeStats;
  entries: EntryView[];
}

export interface SessionTreeNode {
  id: string;
  parentId: string | null;
  sessionFile: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  anchorEntryId?: string;
  firstChildEntryId?: string;
}

export interface SessionTreeState {
  currentNodeId: string;
  root: { sessionFile: string; sessionDir: string };
  nodes: SessionTreeNode[];
  sessions: Record<string, SessionTreeView>;
}

export interface ForkResult {
  sessionFile: string;
}

export interface TruncateResult {
  sessionFile: string;
  deletedEntryCount: number;
  deletedSessionFiles: string[];
}

export interface DeleteBranchResult {
  sessionFile: string;
  deletedSessionFiles: string[];
}
