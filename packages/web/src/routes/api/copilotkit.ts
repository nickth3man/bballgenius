export async function handleCopilotKitChat(body: unknown): Promise<Response> {
  try {
    const openaiApiKey = process.env.OPENROUTER_API_KEY || '';

    if (!openaiApiKey) {
      return Response.json(
        {
          messages: [
            {
              role: 'assistant',
              content:
                'OpenRouter API key not configured. Set OPENROUTER_API_KEY to enable the chatbot.',
            },
          ],
        },
        { status: 200 },
      );
    }

    const { messages: userMessages = [] } = body as { messages?: { content: string; role: string }[] };
    const lastMessage = userMessages[userMessages.length - 1];

    if (!lastMessage?.content) {
      return Response.json(
        { messages: [{ role: 'assistant', content: 'Hello! Ask me anything about NBA.' }] },
        { status: 200 },
      );
    }

    return Response.json(
      {
        messages: [
          {
            role: 'assistant',
            content: `BBallGenius Chatbot\n\nYour question: "${lastMessage.content}"\n\nThis is a scaffold. The LangGraph ReAct agent from packages/data/tabs/chatbot/agent/ will be wired here via CopilotKit + AG-UI. Set OPENROUTER_API_KEY to enable.`,
          },
        ],
      },
      { status: 200 },
    );
  } catch (e: unknown) {
    return Response.json(
      {
        messages: [{ role: 'assistant', content: `Error: ${e instanceof Error ? e.message : String(e)}` }],
      },
      { status: 500 },
    );
  }
}
