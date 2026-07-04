import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	Container,
	Markdown,
	type MarkdownTheme,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { keyHint } from "./keybinding-hints.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/**
 * Renders thinking text truncated to a single visual line with an expand hint.
 * Uses Text (not Markdown) to avoid multi-line wrapping.
 */
class CollapsedThinking {
	private text: string;
	private outputPad: number;

	constructor(text: string, outputPad: number) {
		this.text = text;
		this.outputPad = outputPad;
	}

	invalidate(): void {
		// No cached state to clear
	}

	render(width: number): string[] {
		// Get first visual line (Text wraps at terminal width)
		const tempText = new Text(this.text, 0, 0);
		const visualLines = tempText.render(width);
		const firstLine = visualLines[0] ?? "";

		// Reserve space for the expand suffix
		const suffix = theme.fg("dim", ` ${keyHint("app.tools.expand", "to expand")}`);
		const suffixLen = visibleWidth(suffix);
		const contentWidth = Math.max(1, width - this.outputPad * 2 - suffixLen);
		const truncated = visibleTruncate(firstLine, contentWidth);

		// Build single line: thinking + suffix, all styled
		const line = theme.italic(theme.fg("thinkingText", truncated + suffix));
		// Use Text with padding to render it (handles padding and width correctly)
		const renderText = new Text(line, this.outputPad, 0);
		const rendered = renderText.render(width);
		if (rendered.length === 0) {
			return [" ".repeat(width)];
		}
		// Safety: if wrapping produced multiple lines, collapse to one
		if (rendered.length > 1) {
			return [truncateToWidth(rendered[0], width, "")];
		}
		return [truncateToWidth(rendered[0], width, "")];
	}
}

function visibleTruncate(text: string, maxVisibleWidth: number): string {
	if (visibleWidth(text) <= maxVisibleWidth) return text;
	const ellipsis = "…";
	let truncated = text;
	while (visibleWidth(truncated) > maxVisibleWidth && truncated.length > 0) {
		truncated = truncated.slice(0, -1);
	}
	return truncated + ellipsis;
}

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private expanded = false;
	private markdownTheme: MarkdownTheme;
	private hiddenThinkingLabel: string;
	private outputPad: number;
	private lastMessage?: AssistantMessage;
	private hasToolCalls = false;

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		hiddenThinkingLabel = "Thinking...",
		outputPad = 1,
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;
		this.hiddenThinkingLabel = hiddenThinkingLabel;
		this.outputPad = outputPad;

		// Container for text/thinking content
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	override invalidate(): void {
		super.invalidate();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHiddenThinkingLabel(label: string): void {
		this.hiddenThinkingLabel = label;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (this.hasToolCalls || lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}

	updateContent(message: AssistantMessage): void {
		this.lastMessage = message;

		// Clear content container
		this.contentContainer.clear();

		const hasVisibleContent = message.content.some(
			(c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
		);

		if (hasVisibleContent) {
			this.contentContainer.addChild(new Spacer(1));
		}

		// Render content in order
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				this.contentContainer.addChild(new Markdown(content.text.trim(), this.outputPad, 0, this.markdownTheme));
			} else if (content.type === "thinking" && content.thinking.trim()) {
				// Add spacing only when another visible assistant content block follows.
				// This avoids a superfluous blank line before separately-rendered tool execution blocks.
				const hasVisibleContentAfter = message.content
					.slice(i + 1)
					.some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));

				if (this.hideThinkingBlock) {
					// Show static thinking label when hidden
					this.contentContainer.addChild(
						new Text(theme.italic(theme.fg("thinkingText", this.hiddenThinkingLabel)), this.outputPad, 0),
					);
					if (hasVisibleContentAfter) {
						this.contentContainer.addChild(new Spacer(1));
					}
				} else if (this.expanded) {
					// Thinking traces in thinkingText color, italic
					this.contentContainer.addChild(
						new Markdown(content.thinking.trim(), this.outputPad, 0, this.markdownTheme, {
							color: (text: string) => theme.fg("thinkingText", text),
							italic: true,
						}),
					);
					if (hasVisibleContentAfter) {
						this.contentContainer.addChild(new Spacer(1));
					}
				} else {
					// Collapsed: show only one visual line of thinking plus an expand hint
					this.contentContainer.addChild(new CollapsedThinking(content.thinking.trim(), this.outputPad));
					if (hasVisibleContentAfter) {
						this.contentContainer.addChild(new Spacer(1));
					}
				}
			}
		}

		// Check if incomplete/failed - show after partial content.
		// For aborted/error tool calls, tool execution components show the error.
		// Length stops can happen before a tool call is complete, so surface them here too.
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		this.hasToolCalls = hasToolCalls;
		if (message.stopReason === "length") {
			this.contentContainer.addChild(new Spacer(1));
			this.contentContainer.addChild(
				new Text(
					theme.fg(
						"error",
						"Error: Model stopped because it reached the maximum output token limit. The response may be incomplete.",
					),
					this.outputPad,
					0,
				),
			);
		} else if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", abortMessage), this.outputPad, 0));
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), this.outputPad, 0));
			}
		}
	}
}
