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

export const ChatbotState = new StateSchema({
  messages: MessagesValue,
  sqlRetryCount: z.number().optional(),
  intentCategory: z.string().optional(),
});

export type ChatbotStateType = (typeof ChatbotState)['State'];
export type ChatbotUpdateType = (typeof ChatbotState)['Update'];
