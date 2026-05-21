import { END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';
import { createModel } from './model.js';
import { ChatbotState } from './state.js';
import { queryNbaDb } from './tools.js';

type ChatbotStateType = (typeof ChatbotState)['State'];

const model = createModel().bindTools([queryNbaDb]);

let _toolNode: ToolNode | undefined;

function getToolNode(): ToolNode {
  if (!_toolNode) {
    _toolNode = new ToolNode([queryNbaDb]);
  }
  return _toolNode;
}

async function callModel(state: ChatbotStateType): Promise<Partial<ChatbotStateType>> {
  const response = await model.invoke(state.messages);
  return { messages: [response] };
}

const checkpointer = new MemorySaver();

export const chatbotGraph = new StateGraph(ChatbotState)
  .addNode('llm', callModel)
  .addNode('tools', (state) => getToolNode().invoke(state))
  .addEdge(START, 'llm')
  .addConditionalEdges('llm', toolsCondition, { tools: 'tools', [END]: END })
  .addEdge('tools', 'llm')
  .compile({ checkpointer });
