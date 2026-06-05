/**
 * Multi-agent SQL orchestration graph.
 *
 * Pipeline (LangGraph StateGraph over ChatbotState):
 *
 *   orch_plan  ─►  Send('orch_worker') × N  ─►  orch_synthesize
 *
 * - orch_plan       A planner agent reads the question plus a catalog of EVERY
 *                   schema/table in the database and decomposes it into 1..N
 *                   focused sub-tasks (or flags it as needing clarification).
 * - orch_worker     One SQL specialist agent per sub-task (LangGraph Send fan-out).
 *                   Each worker has its own message history and the full NBA SQL
 *                   toolset, and may query ANY schema/table in the database.
 * - orch_synthesize A synthesizer agent merges the workers' findings into one
 *                   grounded, natural-language answer.
 *
 * The graph writes the final answer as the last AI message on the shared
 * `messages` channel, so the existing streaming + eval layers consume it
 * unchanged.
 */

import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { END, MemorySaver, Overwrite, Send, START, StateGraph } from '@langchain/langgraph';
import { buildSystemPrompt } from '../systemPrompt.js';
import { captureError } from '../utils/errorCapture.js';
import { getAbortSignal } from './abort.js';
import { createModel } from './model.js';
import { buildSchemaCatalog } from './schemaCatalog.js';
import {
  ChatbotState,
  type ChatbotStateType,
  type ChatbotUpdateType,
  type Subtask,
  type WorkerFinding,
} from './state.js';
import { nbaTools } from './tools.js';

const MAX_SUBTASKS = 4;
const MAX_WORKER_TOOL_ROUNDS = 6;

interface InvokableTool {
  invoke(args: unknown): Promise<unknown>;
}
const toolByName = new Map<string, InvokableTool>(
  nbaTools.map((t) => [t.name, t as unknown as InvokableTool]),
);

function messageContentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'string'
          ? part
          : part && typeof part === 'object' && 'text' in part
            ? String((part as { text?: unknown }).text ?? '')
            : '',
      )
      .join('');
  }
  return content == null ? '' : String(content);
}

function lastHumanQuestion(messages: readonly BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message._getType() === 'human') {
      return messageContentToString(message.content).trim();
    }
  }
  // Fall back to the first message content if no explicit human turn is found.
  return messages.length > 0 ? messageContentToString(messages[0]!.content).trim() : '';
}

// ---------------------------------------------------------------------------
// Planner agent
// ---------------------------------------------------------------------------

function plannerPrompt(catalog: string): string {
  return [
    'You are the PLANNER in a multi-agent NBA analytics system. You do NOT write SQL.',
    'Your job is to decompose the user question into focused sub-tasks that independent',
    'SQL worker agents can answer in parallel, then return a JSON plan.',
    '',
    'You have access to EVERY schema and table in the database. The full catalog is below.',
    'Workers can query any of these schemas (main, nbadb, unified_star, stg_bref, api, audit,',
    'and all raw/staging schemas). Never assume a fact is unavailable just because it is not',
    'in the "main" schema.',
    '',
    'Rules:',
    '- Output ONLY a JSON object, no prose, no code fences.',
    '- Shape: {"mode": "single" | "multi" | "clarify", "subtasks": [{"id","focus","question"}]}.',
    '- "single": one self-contained lookup. Emit exactly one subtask whose question equals',
    '  (or lightly rephrases) the user question.',
    '- "multi": the question compares entities or has independent parts. Emit one subtask per',
    `  independent part (max ${MAX_SUBTASKS}). Example: "Who has more MVPs, LeBron or Kareem?"`,
    '  -> two subtasks, one per player.',
    '- "clarify": the question is genuinely ambiguous (e.g. "Who is the best player?",',
    '  "Tell me about the Lakers"). Emit "subtasks": [] and let the synthesizer ask.',
    '- Each subtask "question" must be fully self-contained (no pronouns referring to other',
    '  subtasks). "focus" is a 2-5 word label (e.g. "LeBron MVP count").',
    '- NORMALIZE ambiguous stat intent in the subtask wording:',
    '  - "Who led the NBA in [blocks/rebounds/assists/steals/points/three-pointers] in {season}?"',
    '    with NO "per game"/"average" -> rewrite to "Which player had the highest SEASON TOTAL',
    '    [stat] in {season} (sum of the per-season totals, regular season)?"',
    '  - Keep per-game phrasing only when the user explicitly says "per game" or "average".',
    '',
    'Database catalog (schema: tables):',
    catalog,
  ].join('\n');
}

interface ParsedPlan {
  mode: 'single' | 'multi' | 'clarify';
  subtasks: Subtask[];
}

function parsePlan(raw: string, question: string): ParsedPlan {
  const fallback: ParsedPlan = {
    mode: 'single',
    subtasks: [{ id: 't1', focus: 'primary lookup', question }],
  };

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return fallback;
  }

  if (!parsed || typeof parsed !== 'object') return fallback;
  const obj = parsed as Record<string, unknown>;
  const mode = obj.mode === 'multi' || obj.mode === 'clarify' ? obj.mode : 'single';

  if (mode === 'clarify') return { mode, subtasks: [] };

  const rawSubtasks = Array.isArray(obj.subtasks) ? obj.subtasks : [];
  const subtasks: Subtask[] = rawSubtasks
    .slice(0, MAX_SUBTASKS)
    .map((entry, index) => {
      const e = (entry ?? {}) as Record<string, unknown>;
      const q = typeof e.question === 'string' && e.question.trim() ? e.question.trim() : question;
      return {
        id: typeof e.id === 'string' && e.id.trim() ? e.id.trim() : `t${index + 1}`,
        focus: typeof e.focus === 'string' && e.focus.trim() ? e.focus.trim() : 'lookup',
        question: q,
      };
    })
    .filter((s) => s.question.length > 0);

  if (subtasks.length === 0) return fallback;
  return { mode, subtasks };
}

async function planNode(state: ChatbotStateType): Promise<ChatbotUpdateType> {
  const question = lastHumanQuestion(state.messages);
  const catalog = await buildSchemaCatalog();
  const workerBasePrompt = (await buildSystemPrompt()).trim();

  let plan: ParsedPlan;
  try {
    const response = await createModel().invoke(
      [new SystemMessage(plannerPrompt(catalog)), new HumanMessage(question)],
      getAbortSignal() ? { signal: getAbortSignal() } : {},
    );
    plan = parsePlan(messageContentToString(response.content), question);
  } catch (err) {
    captureError(err, { stage: 'orch_plan' });
    plan = { mode: 'single', subtasks: [{ id: 't1', focus: 'primary lookup', question }] };
  }

  return {
    originalQuestion: question,
    planMode: plan.mode,
    subtasks: plan.subtasks,
    workerBasePrompt,
    workerFindings: new Overwrite([] as WorkerFinding[]),
  };
}

// ---------------------------------------------------------------------------
// SQL worker agents (run in parallel)
// ---------------------------------------------------------------------------

const WORKER_SUFFIX = `
You are a SQL WORKER agent in a multi-agent system. You were given ONE focused sub-task.
- You may query EVERY schema and table in the database, not just main. If a fact is not in
  main, look in nbadb, unified_star, stg_bref, api, audit, or the raw/staging schemas.
- Use the tools to discover schemas/columns and to run read-only SQL.
- Before writing SQL, do schema linking: name the ONE best table and the EXACT columns that
  answer the sub-task (use get_schema_info / find_stat_columns if unsure). Pick season TOTAL
  columns for "total"/"led the league" questions and per-game columns only when asked. Then
  write the smallest correct query. This planning is internal — do not narrate it in the final
  finding.
- Answer ONLY your sub-task. Be concise and factual. Report exact entities and exact numbers
  from the query results — never invent or round numbers.
- Name matching: player names may be stored WITH accents (e.g. "Nikola Jokić", "Luka Dončić").
  ALWAYS match names accent-insensitively using strip_accents on both sides, e.g.
  WHERE strip_accents(player_name) = strip_accents('Nikola Jokic'). If a plain = match on a name
  returns no rows, retry with strip_accents before concluding the data is absent.
- When you have enough evidence, stop calling tools and state your finding in one or two
  sentences, including the concrete value(s) you found.
- If the data is genuinely absent after checking the relevant schemas, say
  "Not available in the database." Do not guess.
`.trim();

async function runWorker(subtask: Subtask, basePrompt: string): Promise<WorkerFinding> {
  const model = createModel().bindTools([...nbaTools]);
  const messages: BaseMessage[] = [
    new SystemMessage(
      `${basePrompt}\n\n${WORKER_SUFFIX}\n\nYour focused sub-task (${subtask.focus}): ${subtask.question}`,
    ),
    new HumanMessage(subtask.question),
  ];

  let toolCalls = 0;

  for (let round = 0; round < MAX_WORKER_TOOL_ROUNDS; round++) {
    const response = (await model.invoke(
      messages,
      getAbortSignal() ? { signal: getAbortSignal() } : {},
    )) as AIMessage;
    messages.push(response);

    const calls = response.tool_calls ?? [];
    if (calls.length === 0) {
      return {
        id: subtask.id,
        focus: subtask.focus,
        finding: messageContentToString(response.content).trim() || 'No finding produced.',
        toolCalls,
      };
    }

    for (const call of calls) {
      toolCalls++;
      const tool = call.name ? toolByName.get(call.name) : undefined;
      let output: string;
      try {
        output = tool ? String(await tool.invoke(call.args)) : `Unknown tool "${call.name}".`;
      } catch (err) {
        captureError(err, { stage: 'orch_worker', toolName: call.name, intent: subtask.focus });
        output = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
      }
      messages.push(
        new ToolMessage({
          content: output,
          tool_call_id: call.id ?? `${call.name}-${toolCalls}`,
          name: call.name,
        }),
      );
    }
  }

  // Tool budget exhausted: force a tool-free summary of what was gathered.
  const summary = await createModel().invoke(
    [
      ...messages,
      new SystemMessage(
        'Tool budget reached. State your best factual finding now using ONLY the data already ' +
          'retrieved above. Do not request more tools.',
      ),
    ],
    getAbortSignal() ? { signal: getAbortSignal() } : {},
  );

  return {
    id: subtask.id,
    focus: subtask.focus,
    finding: messageContentToString(summary.content).trim() || 'No finding produced.',
    toolCalls,
  };
}

async function workerNode(state: ChatbotStateType): Promise<ChatbotUpdateType> {
  const subtask = state.activeSubtask;
  if (!subtask) {
    return { workerFindings: [] };
  }

  const basePrompt = state.workerBasePrompt ?? (await buildSystemPrompt()).trim();
  const finding = await runWorker(subtask, basePrompt);
  return { workerFindings: [finding] };
}

function dispatchWorkers(state: ChatbotStateType): Send[] | 'orch_synthesize' {
  if (state.planMode === 'clarify' || !state.subtasks || state.subtasks.length === 0) {
    return 'orch_synthesize';
  }
  return state.subtasks.map((subtask) => new Send('orch_worker', { activeSubtask: subtask }));
}

// ---------------------------------------------------------------------------
// Synthesizer agent
// ---------------------------------------------------------------------------

const SYNTH_PROMPT = `
You are the SYNTHESIZER in a multi-agent NBA analytics system. You are given the user's
question and the findings of one or more SQL worker agents. Compose the final answer.

Rules:
- Answer ONLY the user's question, in clear natural language. Never output raw SQL.
- Always name the subject explicitly (the player/team/season the question is about) rather than
  relying on pronouns, and include the key number/value the findings provide.
- Use ONLY facts and numbers present in the worker findings. Report numbers exactly as given;
  never invent, round, or estimate.
- For comparison questions, state the winner and both compared values.
- If the question was flagged as ambiguous (no findings provided), ask ONE concise
  clarification question instead of guessing.
- If the workers reported the data is missing/absent/not in the database, OR the question asks
  whether the database includes/contains something it does not, respond with EXACTLY this
  sentence: "I do not have that information in the database." Do not paraphrase it (avoid
  wording like "does not include").
- Emit exactly one final answer. Do not add follow-up offers.
`.trim();

function buildSynthInput(state: ChatbotStateType): string {
  const question = state.originalQuestion ?? lastHumanQuestion(state.messages);
  if (state.planMode === 'clarify') {
    return `User question (flagged ambiguous — ask one clarifying question): ${question}`;
  }
  const findings = state.workerFindings ?? [];
  const findingLines =
    findings.length > 0
      ? findings.map((f) => `- [${f.focus}] ${f.finding}`).join('\n')
      : '- (no findings)';
  return `User question: ${question}\n\nWorker findings:\n${findingLines}`;
}

async function synthesizeNode(state: ChatbotStateType): Promise<ChatbotUpdateType> {
  const response = await createModel().invoke(
    [new SystemMessage(SYNTH_PROMPT), new HumanMessage(buildSynthInput(state))],
    getAbortSignal() ? { signal: getAbortSignal() } : {},
  );
  const text = messageContentToString(response.content).trim();
  return { messages: [new AIMessage(text)] };
}

// ---------------------------------------------------------------------------
// Graph assembly
// ---------------------------------------------------------------------------

function buildOrchestratorGraph() {
  return new StateGraph(ChatbotState)
    .addNode('orch_plan', planNode)
    .addNode('orch_worker', workerNode)
    .addNode('orch_synthesize', synthesizeNode)
    .addEdge(START, 'orch_plan')
    .addConditionalEdges('orch_plan', dispatchWorkers, ['orch_worker', 'orch_synthesize'])
    .addEdge('orch_worker', 'orch_synthesize')
    .addEdge('orch_synthesize', END)
    .compile({ checkpointer: new MemorySaver() });
}

let _orchestrator: ReturnType<typeof buildOrchestratorGraph> | undefined;

export function getOrchestratorGraph() {
  if (!_orchestrator) {
    _orchestrator = buildOrchestratorGraph();
  }
  return _orchestrator;
}

export function resetOrchestratorGraph(): void {
  _orchestrator = undefined;
}

// Exported for unit testing.
export { buildSynthInput, parsePlan, plannerPrompt, runWorker };
