BBallGenius Chatbot — Implementation Plan
Architecture
src/chatbot/
├── index.ts          # Entry: bootstrap + start
├── chatApp.ts        # App shell (OpenTUI root, layout)
├── openrouter.ts     # OpenRouter API wrapper (fetch SSE streaming)
├── db.ts             # DuckDB connector (shared path resolution)
├── systemPrompt.ts   # Schema injection + system prompt builder
├── conversation.ts   # In-memory Message[] history + trim
├── features/
│   ├── nlToSql.ts    # NL→SQL generation + auto-execute
│   ├── tradeAnalyzer.ts
│   └── goatDebate.ts
└── __tests__/
    └── (future)
src/hub/core/db.ts    # Shared via explicit refactor later; for now duplicate `resolveDbPath()`
UI Layout (OpenTUI — distinct from hub style)
┌────────────────────────────────────────────────────┐
│  🏀 BBallGenius Chat  │  qwen3-coder:free          │  ← header (BoxRenderable, border:'bottom')
├────────────────────────────────────────────────────┤
│                                                    │
│  User: Who had the best PER in 2016?              │  ← ScrollBoxRenderable (flexGrow:1)
│                                                    │     stickyScroll:true, stickyStart:'bottom'
│  AI: LeBron James led with 26.3 PER...            │     TextRenderable with ANSI→StyledText
│                                                    │
├────────────────────────────────────────────────────┤
│  > _                                              │  ← InputRenderable (height:3, fixed bottom)
└────────────────────────────────────────────────────┘
                                             footer (1 line)
Phase 1: Core NL → SQL (build this first)
Flow:
1. User types question → 'enter' event fires
2. appendMessage('user', text) → render
3. System prompt (with DuckDB schema from getTables()/getColumns()) + conversation history → OpenRouter
4. LLM generates SQL (in  ``sql ``` ` block or via tool call)
5. Run SQL against query() from DuckDB
6. LLM receives results, explains them
7. Streaming response token-by-token via SSE for await
8. appendMessage('assistant', fullResponse) → render, scroll to bottom
Key dependency: bun add openai (use with baseURL: 'https://openrouter.ai/api/v1')
Model: qwen/qwen3-coder:free (free, 1M context, tool-calling, code-optimized)
Streaming pattern:
const stream = await openai.chat.completions.create({
  model: 'qwen/qwen3-coder:free',
  messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
  stream: true,
});
for await (const chunk of stream) {
  const token = chunk.choices[0]?.delta?.content;
  if (token) { outputBuffer += token; requestRender(); }
}
Focus cycle: 2 widgets — [chatScroll, promptInput] — focusIndex toggles on Tab/Shift+Tab
Schema injection (built into system prompt at startup):
Pull all tables/columns via getTables()/getColumns(), format as markdown table, inject into system prompt. Include key SQL hints (CTE for dim_team dedup, LIMIT 20 default, ROUND for stats).
Phase 2+: Creative features
Feature	Data Source	LLM Role
Trade Analyzer	fact_player_season_stats, dim_player	Simulate roster changes, project ratings
GOAT Debate	Career stats, fact_player_awards, advanced metrics	Argue both sides with data
Historical Matchup	Time Machine data, era stats	Reason about style/era differences
Clutch Analyst	fact_pbp_events filtered by 4th quarter/close game	Rank, explain, compare
Career Arc	Season-by-season stats per player	Identify peaks/valleys, narrative
Files to create (Phase 1)
1. src/chatbot/index.ts — replace stub, boot OpenTUI renderer, init DB, create app shell
2. src/chatbot/chatApp.ts — ChatApp class: root Box, ScrollBox+Text for history, Input for prompt, focus cycle, message handling
3. src/chatbot/openrouter.ts — streamChat(messages) → token-by-token async generator, complete(messages) → full response
4. src/chatbot/db.ts — duplicated resolveDbPath() + query() (from hub) or shared via future refactor
5. src/chatbot/systemPrompt.ts — buildSystemPrompt(tables, columns) → formatted system message
6. src/chatbot/conversation.ts — ConversationManager class: add/trim/getMessages
New package.json scripts
"chatbot:start": "bun run src/chatbot/index.ts"
New dependencies
bun add openai   # OpenAI-compatible SDK, works with OpenRouter via baseURL
Key gotchas (from OpenTUI source verification)
- ANSI→StyledText: Must convert raw ANSI before assigning to TextRenderable.content
- No SplitPane: Use BoxRenderable with flexDirection:'column' + flexGrow:1 + fixed height
- requestRender(): Safe to call during streaming — schedules next frame
- ScrollBox.reset: After new message, set .scrollTop = .scrollHeight (or use stickyScroll:true, stickyStart:'bottom')
- InputRenderable: Only 'enter' event needed; .value getter for current text
- Focus: Must explicitly blur all widgets, then focus exactly one