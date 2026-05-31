import { MessagesValue, Overwrite, ReducedValue, StateSchema } from '@langchain/langgraph';
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
  originalQuestion: z.string().optional(),
  planMode: z.enum(['single', 'multi', 'clarify']).optional(),
  subtasks: z.array(SubtaskSchema).optional(),
  workerBasePrompt: z.string().optional(),
  /** Set by Send dispatch; one sub-task per parallel worker invocation. */
  activeSubtask: SubtaskSchema.optional(),
  workerFindings: new ReducedValue(z.array(WorkerFindingSchema).default([]), {
    reducer: (existing, update) => {
      if (update instanceof Overwrite) {
        return update.value;
      }
      return [...(existing ?? []), ...(update ?? [])];
    },
  }),
});

export type ChatbotStateType = (typeof ChatbotState)['State'];
export type ChatbotUpdateType = (typeof ChatbotState)['Update'];
