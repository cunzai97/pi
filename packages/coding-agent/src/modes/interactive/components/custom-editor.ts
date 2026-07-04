import * as fs from "node:fs";
import * as path from "node:path";
import { Editor, type EditorOptions, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import type { AppKeybinding, KeybindingsManager } from "../../../core/keybindings.ts";

const MAX_HISTORY_SIZE = 500;

function loadHistoryFromFile(historyFile: string): string[] {
	try {
		const content = fs.readFileSync(historyFile, "utf-8");
		const lines = content
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
		// File stores oldest first; editor expects newest first
		return lines.reverse().slice(0, MAX_HISTORY_SIZE);
	} catch {
		return [];
	}
}

function appendHistoryToFile(historyFile: string, text: string): void {
	try {
		const dir = path.dirname(historyFile);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
		fs.appendFileSync(historyFile, text + "\n", "utf-8");
		// Trim file if it grows too large
		try {
			const content = fs.readFileSync(historyFile, "utf-8");
			const lines = content.split("\n").filter(Boolean);
			if (lines.length > MAX_HISTORY_SIZE) {
				fs.writeFileSync(historyFile, lines.slice(-MAX_HISTORY_SIZE).join("\n") + "\n", "utf-8");
			}
		} catch {
			// Best effort trimming
		}
	} catch {
		// Best effort persistence
	}
}

/**
 * Custom editor that handles app-level keybindings for coding-agent.
 */
export class CustomEditor extends Editor {
	private keybindings: KeybindingsManager;
	private readonly historyFile: string | undefined;
	public actionHandlers: Map<AppKeybinding, () => void> = new Map();

	// Special handlers that can be dynamically replaced
	public onEscape?: () => void;
	public onCtrlD?: () => void;
	public onPasteImage?: () => void;
	/** Handler for extension-registered shortcuts. Returns true if handled. */
	public onExtensionShortcut?: (data: string) => boolean;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		options?: EditorOptions & { historyFile?: string },
	) {
		const historyFile = options?.historyFile;
		const initialHistory = historyFile ? loadHistoryFromFile(historyFile) : undefined;
		super(tui, theme, { ...options, initialHistory });
		this.keybindings = keybindings;
		this.historyFile = historyFile;
	}

	override addToHistory(text: string): void {
		super.addToHistory(text);
		if (this.historyFile) {
			appendHistoryToFile(this.historyFile, text);
		}
	}

	/**
	 * Register a handler for an app action.
	 */
	onAction(action: AppKeybinding, handler: () => void): void {
		this.actionHandlers.set(action, handler);
	}

	handleInput(data: string): void {
		// Check extension-registered shortcuts first
		if (this.onExtensionShortcut?.(data)) {
			return;
		}

		// Check for paste image keybinding
		if (this.keybindings.matches(data, "app.clipboard.pasteImage")) {
			this.onPasteImage?.();
			return;
		}

		// Check app keybindings first

		// Escape/interrupt - only if autocomplete is NOT active
		if (this.keybindings.matches(data, "app.interrupt")) {
			if (!this.isShowingAutocomplete()) {
				// Use dynamic onEscape if set, otherwise registered handler
				const handler = this.onEscape ?? this.actionHandlers.get("app.interrupt");
				if (handler) {
					handler();
					return;
				}
			}
			// Let parent handle escape for autocomplete cancellation
			super.handleInput(data);
			return;
		}

		// Exit (Ctrl+D) - only when editor is empty
		if (this.keybindings.matches(data, "app.exit")) {
			if (this.getText().length === 0) {
				const handler = this.onCtrlD ?? this.actionHandlers.get("app.exit");
				if (handler) handler();
				return;
			}
			// Fall through to editor handling for delete-char-forward when not empty
		}

		// Check all other app actions
		for (const [action, handler] of this.actionHandlers) {
			if (action !== "app.interrupt" && action !== "app.exit" && this.keybindings.matches(data, action)) {
				handler();
				return;
			}
		}

		// Pass to parent for editor handling
		super.handleInput(data);
	}
}
