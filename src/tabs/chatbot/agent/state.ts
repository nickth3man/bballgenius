import { MessagesValue, StateSchema } from '@langchain/langgraph';
import { z } from 'zod/v4';

export type IntentCategory =
  | 'career_leaders'
  | 'season_leaders'
  | 'awards'
  | 'team_seasons'
  | 'games'
  | 'shot_charts'
  | 'play_by_play'
  | 'identity'
  | 'draft'
  | 'data_quality'
  | 'cross_schema'
  | 'general';

/** A single decomposed sub-question produced by the orchestrator's planner. */
export const SubtaskSchema = z.object({
  id: z.string(),
  focus: z.string(),
  question: z.string(),
});
export type Subtask = z.infer<typeof SubtaskSchema>;

/** A SQL worker agent's answer to one sub-task. */
export const WorkerFindingSchema = z.object({
  id: z.string(),
  focus: z.string(),
  finding: z.string(),
  toolCalls: z.number(),
});
export type WorkerFinding = z.infer<typeof WorkerFindingSchema>;

export type PlanMode = 'single' | 'multi' | 'clarify';

export const ChatbotState = new StateSchema({
  messages: MessagesValue,
  sqlRetryCount: z.number().optional(),
  intentCategory: z.string().optional(),
  totalToolCalls: z.number().optional(),
  validateAnswerRetries: z.number().optional(),
  // Multi-agent orchestration channels. Each is written by exactly one node
  // per run, so the default last-value semantics are sufficient (no reducer).
  originalQuestion: z.string().optional(),
  planMode: z.enum(['single', 'multi', 'clarify']).optional(),
  subtasks: z.array(SubtaskSchema).optional(),
  workerFindings: z.array(WorkerFindingSchema).optional(),
});

export type ChatbotStateType = (typeof ChatbotState)['State'];
export type ChatbotUpdateType = (typeof ChatbotState)['Update'];
