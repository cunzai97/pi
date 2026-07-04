import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";

// ============================================================================
// Types
// ============================================================================

export interface AskChoice {
	/** Display text for the choice (1-5 words, concise) */
	label: string;
	/** Explanation of the choice (optional) */
	description?: string;
}

export interface AskQuestion {
	/** The question to ask the user */
	question: string;
	/** Available choices. Omit for open-ended text input. */
	choices?: AskChoice[];
	/** Allow selecting multiple choices (default: false). Ignored when choices is omitted. */
	multiple?: boolean;
}

const askChoiceSchema = Type.Object({
	label: Type.String({ description: "Display text for the choice (1-5 words, concise)" }),
	description: Type.Optional(Type.String({ description: "Explanation of the choice" })),
});

const askQuestionSchema = Type.Object({
	question: Type.String({ description: "The question to ask the user" }),
	choices: Type.Optional(
		Type.Array(askChoiceSchema, { description: "Available choices. Omit for open-ended text input." }),
	),
	multiple: Type.Optional(
		Type.Boolean({
			description: "Allow selecting multiple choices (default: false). Ignored when choices is omitted.",
		}),
	),
});

const askToolSchema = Type.Object({
	questions: Type.Array(askQuestionSchema, { description: "Questions to ask the user" }),
});

export type AskToolInput = Static<typeof askToolSchema>;

// ============================================================================
// Tool Definition
// ============================================================================

const askToolDescription = `Pause execution and ask the user one or more questions. The agent waits for the user's response before continuing.

## Question types
- **Single-choice**: provide \`choices\` (default behavior)
- **Multi-choice**: provide \`choices\` with \`multiple: true\`
- **Open-ended**: omit \`choices\` for free-text input

## Usage notes
- Use when you need user input to make a decision, clarify requirements, or gather preferences
- Keep questions focused and choices concise
- If you recommend a specific option, place it first in the choices list
- The user can cancel at any time, which will cause the tool to fail with a cancellation error`;

export function createAskToolDefinition(
	_cwd: string,
	_options?: Record<string, unknown>,
): ToolDefinition<typeof askToolSchema, undefined> {
	return {
		name: "ask",
		label: "ask",
		description: askToolDescription,
		promptSnippet: "Pause and ask the user questions (single-choice, multi-choice, or open-ended)",
		parameters: askToolSchema,
		async execute(
			_toolCallId: string,
			params: AskToolInput,
			signal: AbortSignal | undefined,
			_onUpdate: AgentToolUpdateCallback<undefined> | undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<undefined>> {
			if (!ctx.hasUI) {
				return {
					content: [
						{
							type: "text",
							text: "Error: ask requires interactive UI. This tool is only available in interactive mode.",
						},
					],
					details: undefined,
				};
			}

			const answers: string[] = [];

			for (const q of params.questions) {
				if (signal?.aborted) break;

				if (!q.choices || q.choices.length === 0) {
					// Open-ended question
					const answer = await ctx.ui.input(q.question);
					if (answer === undefined) {
						return {
							content: [{ type: "text", text: "The user cancelled the question." }],
							details: undefined,
						};
					}
					answers.push(answer);
				} else if (q.multiple) {
					// Multi-choice question
					const selected: string[] = [];
					while (true) {
						const options = [...q.choices.map((c) => c.label), `Done (${selected.length} selected)`];
						const choice = await ctx.ui.select(q.question, options);
						if (choice === undefined) {
							if (selected.length > 0) {
								answers.push(selected.join(", "));
							} else {
								return {
									content: [{ type: "text", text: "The user cancelled the question." }],
									details: undefined,
								};
							}
							break;
						}
						if (choice.startsWith("Done")) {
							answers.push(selected.length > 0 ? selected.join(", ") : "(none)");
							break;
						}
						if (!selected.includes(choice)) {
							selected.push(choice);
						}
					}
				} else {
					// Single-choice question
					const options = q.choices.map((c) => c.label);
					const choice = await ctx.ui.select(q.question, options);
					if (choice === undefined) {
						return {
							content: [{ type: "text", text: "The user cancelled the question." }],
							details: undefined,
						};
					}
					answers.push(choice);
				}
			}

			const formatted = params.questions.map((q, i) => `"${q.question}"="${answers[i] ?? "skipped"}"`).join("\n");

			return {
				content: [
					{
						type: "text",
						text: `The user answered your question(s):\n${formatted}`,
					},
				],
				details: undefined,
			};
		},
	};
}

export function createAskTool(_cwd: string, _options?: Record<string, unknown>): AgentTool<typeof askToolSchema> {
	const definition = createAskToolDefinition(_cwd, _options);
	return {
		name: definition.name,
		label: definition.label,
		description: definition.description,
		parameters: definition.parameters,
		execute: (
			toolCallId: string,
			params: AskToolInput,
			signal?: AbortSignal,
			onUpdate?: AgentToolUpdateCallback<undefined>,
		): Promise<AgentToolResult<undefined>> => {
			const stubCtx = {
				hasUI: false,
				ui: {
					select: async () => undefined,
					confirm: async () => false,
					input: async () => undefined,
					notify: () => {},
				},
				cwd: _cwd,
			} as unknown as ExtensionContext;
			return definition.execute(toolCallId, params, signal, onUpdate, stubCtx);
		},
	};
}
