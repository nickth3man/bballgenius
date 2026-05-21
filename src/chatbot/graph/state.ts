import { MessagesValue, StateSchema } from '@langchain/langgraph';

export const ChatbotState = new StateSchema({
  messages: MessagesValue,
});

export type ChatbotStateType = (typeof ChatbotState)['State'];
export type ChatbotUpdateType = (typeof ChatbotState)['Update'];
