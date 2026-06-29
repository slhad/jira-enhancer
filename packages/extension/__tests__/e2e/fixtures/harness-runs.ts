import { MessageType } from '@jira-enhancer/shared';
import type {
  EnhancementStateResponse,
  EnhanceResponse,
  HarnessEvent,
  ListModelsResponse,
} from '@jira-enhancer/shared';

export const replaySessionId = 'session-smoke-1';
export const replayIssueKey = 'PROJ-123';
export const replayRequestId = 'req-smoke-1';

export const fullPageSession = {
  sourceTabId: 101,
  sourceTabUrl: `https://example.atlassian.net/browse/${replayIssueKey}`,
  issueKey: replayIssueKey,
  description: 'As a user, I can reset my password.',
  storyPoints: '3',
  acceptanceCriteria: '- Sends reset email\n- Link expires after 30 minutes',
  components: ['Auth'],
  issueType: 'Story',
  images: [],
  pendingEnhancement: {
    mode: 'default',
    app: 'pi',
    modelProvider: 'anthropic',
    model: 'claude-smoke',
    launchPath: '/tmp/sanitized-project',
    env: {
      AWS_PROFILE: 'test-profile',
      AWS_REGION: 'us-east-1',
    },
  },
} as const;

export const listModelsResponse: ListModelsResponse = {
  type: MessageType.LIST_MODELS_RESPONSE,
  id: 'models-smoke',
  app: 'pi',
  models: [{ provider: 'anthropic', model: 'claude-smoke' }],
};

export const harnessReplayEvents: HarnessEvent[] = [
  {
    type: MessageType.HARNESS_EVENT,
    id: replayRequestId,
    app: 'pi',
    kind: 'message',
    text: 'Inspecting sanitized ticket fields.',
    timestamp: 1000,
  },
  {
    type: MessageType.HARNESS_EVENT,
    id: replayRequestId,
    app: 'pi',
    kind: 'tool_call',
    text: 'Using read-only tool: ffgrep',
    timestamp: 1001,
  },
  {
    type: MessageType.HARNESS_EVENT,
    id: replayRequestId,
    app: 'pi',
    kind: 'tool_result',
    text: 'ffgrep completed.',
    timestamp: 1002,
  },
];

export const enhanceReplayResponse: EnhanceResponse = {
  type: MessageType.ENHANCE_RESPONSE,
  id: replayRequestId,
  originalDescription: fullPageSession.description,
  refinedDescription: 'Enhanced sanitized description.',
  originalFields: {
    description: fullPageSession.description,
    acceptanceCriteria: fullPageSession.acceptanceCriteria,
    storyPoints: fullPageSession.storyPoints,
  },
  enhancedFields: {
    description: 'Enhanced sanitized description.',
    acceptanceCriteria: '- User receives reset email\n- Link expires safely',
    storyPoints: '3',
    notes: 'Smoke replay fixture only.',
  },
};

export const restoredEnhancementState: EnhancementStateResponse = {
  type: MessageType.ENHANCEMENT_STATE,
  issueKey: replayIssueKey,
  requestId: replayRequestId,
  status: 'refining',
  progress: 55,
  originalDescription: 'Original sanitized description.',
  originalFields: {
    description: 'Original sanitized description.',
    acceptanceCriteria: '- Original AC',
    storyPoints: '2',
  },
  events: [
    {
      type: MessageType.HARNESS_EVENT,
      id: replayRequestId,
      app: 'pi',
      kind: 'message',
      text: 'Continuing sanitized replay.',
      timestamp: 1000,
    },
  ],
};

export const historicalResults = [
  {
    id: 'hist-2',
    issueKey: replayIssueKey,
    createdAt: 1_700_000_100_000,
    originalDescription: 'Original sanitized description.',
    refinedDescription: 'Second historical enhanced description.',
    originalFields: {
      description: 'Original sanitized description.',
      acceptanceCriteria: '- Original AC',
      storyPoints: '2',
    },
    enhancedFields: {
      description: 'Second historical enhanced description.',
      acceptanceCriteria: '- Second historical AC',
      storyPoints: '3',
      notes: 'Second smoke fixture.',
    },
    modelProvider: 'anthropic',
    model: 'claude-smoke',
  },
  {
    id: 'hist-1',
    issueKey: replayIssueKey,
    createdAt: 1_700_000_000_000,
    originalDescription: 'Original sanitized description.',
    refinedDescription: 'First historical enhanced description.',
    originalFields: {
      description: 'Original sanitized description.',
      acceptanceCriteria: '- Original AC',
      storyPoints: '2',
    },
    enhancedFields: {
      description: 'First historical enhanced description.',
      acceptanceCriteria: '- First historical AC',
      storyPoints: '5',
      notes: 'First smoke fixture.',
    },
    modelProvider: 'anthropic',
    model: 'claude-smoke',
  },
];
