import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import { Container, Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import type { SessionManager } from "../session-manager.ts";

// ============================================================================
// Types
// ============================================================================

export interface TodoItem {
	/** Brief description of the task */
	content: string;
	/** Current status of the task */
	status: "pending" | "in_progress" | "completed" | "cancelled";
}

const todoItemSchema = Type.Object({
	content: Type.String({ description: "Brief description of the task" }),
	status: Type.Union([
		Type.Literal("pending"),
		Type.Literal("in_progress"),
		Type.Literal("completed"),
		Type.Literal("cancelled"),
	]),
});

const todoToolSchema = Type.Object({
	todos: Type.Array(todoItemSchema, {
		description: "The complete updated todo list (full replacement, not incremental)",
	}),
});

export type TodoToolInput = Static<typeof todoToolSchema>;

// ============================================================================
// Persistence
// ============================================================================

const TODO_CUSTOM_TYPE = "todo_update";

/** In-memory todo store, keyed by session file path. */
const todoStore = new Map<string, TodoItem[]>();

function getSessionKey(ctx: ExtensionContext): string {
	return ctx.sessionManager.getSessionFile() ?? ctx.cwd;
}

function setTodos(ctx: ExtensionContext, todos: TodoItem[]): void {
	const key = getSessionKey(ctx);
	todoStore.set(key, todos);
	(ctx.sessionManager as SessionManager).appendCustomEntry(TODO_CUSTOM_TYPE, todos);
}

// ============================================================================
// Widget Rendering
// ============================================================================

function statusSymbol(status: TodoItem["status"]): string {
	switch (status) {
		case "completed":
			return "[x]";
		case "in_progress":
			return "[>]";
		case "cancelled":
			return "[-]";
		case "pending":
			return "[ ]";
	}
}

/** Maximum number of todo items to show in the widget panel. */
const MAX_TODO_LINES = 12;

function createTodoWidget(todos: TodoItem[], theme: Theme): Container {
	const container = new Container();

	if (todos.length === 0) {
		return container;
	}

	for (const todo of todos.slice(0, MAX_TODO_LINES)) {
		const symbol = statusSymbol(todo.status);
		const line = `${symbol} ${todo.content}`;

		let text: string;
		if (todo.status === "completed" || todo.status === "cancelled") {
			text = theme.fg("muted", line);
		} else if (todo.status === "in_progress") {
			text = theme.bold(line);
		} else {
			text = line;
		}

		container.addChild(new Text(text, 1, 0));
	}

	return container;
}

function updateTodoWidget(ctx: ExtensionContext, todos: TodoItem[]): void {
	if (todos.length === 0) {
		ctx.ui.setWidget("todo", undefined);
		return;
	}

	ctx.ui.setWidget("todo", (_tui, theme) => createTodoWidget(todos, theme), { placement: "aboveEditor" });
}

// ============================================================================
// Tool Definition
// ============================================================================

const todoToolDescription = `Create and maintain a structured task list for the current coding session. Tracks progress, organizes multi-step work, and surfaces status to the user.

## When to use
Use proactively when:
- The task requires 3+ distinct steps or actions
- The work is non-trivial and benefits from planning
- The user provides multiple tasks or explicitly asks for a todo list
- New instructions arrive - capture them as todos
- You start a task - mark it \`in_progress\` (only one at a time) before working
- You finish a task - mark it \`completed\` and add any follow-ups

## When NOT to use
Skip when:
- The work is a single, straightforward task
- The request is purely informational or conversational
- Tracking adds no organizational value

## States
- \`pending\` - not started
- \`in_progress\` - actively working (exactly ONE at a time)
- \`completed\` - finished successfully
- \`cancelled\` - no longer needed

## Rules
- Update status in real time; don't batch completions
- Mark \`completed\` only after the work is actually done
- Keep exactly one \`in_progress\` while work remains
- Preserve original order - tasks are sequential, not prioritized
- Items should be specific and actionable`;

export function createTodoToolDefinition(
	_cwd: string,
	_options?: Record<string, unknown>,
): ToolDefinition<typeof todoToolSchema, undefined> {
	return {
		name: "todo",
		label: "todo",
		description: todoToolDescription,
		promptSnippet: "Create and maintain a structured task list",
		promptGuidelines: [
			"Update todo status in real time; don't batch completions.",
			"Keep exactly one in_progress task at a time.",
			"Mark completed only after the work is actually done.",
		],
		parameters: todoToolSchema,
		async execute(
			_toolCallId: string,
			params: TodoToolInput,
			_signal: AbortSignal | undefined,
			_onUpdate: AgentToolUpdateCallback<undefined> | undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<undefined>> {
			setTodos(ctx, params.todos);
			updateTodoWidget(ctx, params.todos);

			const lines = params.todos.map((todo) => {
				const symbol = statusSymbol(todo.status);
				return `${symbol} ${todo.content}`;
			});

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: undefined,
			};
		},
	};
}

export function createTodoTool(_cwd: string, _options?: Record<string, unknown>): AgentTool<typeof todoToolSchema> {
	const definition = createTodoToolDefinition(_cwd, _options);
	return {
		name: definition.name,
		label: definition.label,
		description: definition.description,
		parameters: definition.parameters,
		execute: (
			toolCallId: string,
			params: TodoToolInput,
			signal?: AbortSignal,
			onUpdate?: AgentToolUpdateCallback<undefined>,
		): Promise<AgentToolResult<undefined>> => {
			const stubCtx = {
				sessionManager: {
					getSessionFile: () => undefined,
					getEntries: () => [],
				},
				ui: {
					setWidget: () => {},
				},
				cwd: _cwd,
			} as unknown as ExtensionContext;
			return definition.execute(toolCallId, params, signal, onUpdate, stubCtx);
		},
	};
}
