import * as vscode from 'vscode';

/**
 * JSONの行からドット区切りキーの最初のセグメント（プレフィックス）を取得する。
 * 例: `"advancements.foo.bar": "baz"` -> `"advancements"`
 * キーにドットが含まれない行や、JSONキーでない行は null を返す。
 */
function extractPrefix(line: string): string | null {
	const match = line.match(/^\s*"([^"]+)"\s*:/);
	if (!match) {
		return null;
	}
	const key = match[1];
	const dotIndex = key.indexOf('.');
	if (dotIndex === -1) {
		return null;
	}
	return key.substring(0, dotIndex);
}

/** グループの情報（先頭行・件数） */
interface Group {
	prefix: string;
	startLine: number;
	count: number;
}

/**
 * ドキュメント全体を走査し、同一プレフィックスが連続する行をグループとして返す。
 * 件数が1のグループ（折りたたみ不要）も含む。
 */
function collectGroups(document: vscode.TextDocument): Group[] {
	const groups: Group[] = [];

	let groupStart: number | null = null;
	let groupPrefix: string | null = null;
	let groupCount = 0;

	const pushGroup = () => {
		if (groupStart !== null && groupPrefix !== null && groupCount >= 1) {
			groups.push({ prefix: groupPrefix, startLine: groupStart, count: groupCount });
		}
	};

	for (let i = 0; i < document.lineCount; i++) {
		const lineText = document.lineAt(i).text;
		const prefix = extractPrefix(lineText);

		if (prefix !== null && prefix === groupPrefix) {
			groupCount++;
			continue;
		}

		// プレフィックスが変わった -> 前のグループを確定
		pushGroup();

		if (prefix !== null) {
			groupStart = i;
			groupPrefix = prefix;
			groupCount = 1;
		} else {
			groupStart = null;
			groupPrefix = null;
			groupCount = 0;
		}
	}

	// ファイル末尾で未確定のグループを確定
	pushGroup();

	return groups;
}

const FOLD_COMMAND = 'translation-tree.fold';
const UNFOLD_COMMAND = 'translation-tree.unfold';

/**
 * Code Lens プロバイダ。
 * 各グループの startLine に折りたたみ／展開ボタンを表示する。
 * 状態（折りたたみ済みかどうか）を内部で管理し、ラベルを切り替える。
 *
 * 折りたたみは FoldingRangeProvider の事前定義に依存せず、
 * editor.createFoldingRangeFromSelection でその場で手動範囲を作成して行う。
 */
class TranslationCodeLensProvider implements vscode.CodeLensProvider {
	private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

	/** 折りたたみ済みグループのキー集合。キー形式: "startLine:endLine" */
	private readonly foldedKeys = new Set<string>();

	static groupKey(startLine: number, endLine: number): string {
		return `${startLine}:${endLine}`;
	}

	refresh(): void {
		this._onDidChangeCodeLenses.fire();
	}

	markFolded(key: string): void {
		this.foldedKeys.add(key);
		this._onDidChangeCodeLenses.fire();
	}

	markUnfolded(key: string): void {
		this.foldedKeys.delete(key);
		this._onDidChangeCodeLenses.fire();
	}

	/** ドキュメント編集時に行番号がずれるため、折りたたみ状態をリセットする */
	clearFoldedKeys(): void {
		this.foldedKeys.clear();
	}

	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		if (document.languageId !== 'json') {
			return [];
		}

		const groups = collectGroups(document).filter(g => g.count > 1);
		const lenses: vscode.CodeLens[] = [];

		for (const g of groups) {
			const endLine = g.startLine + g.count - 1;
			const key = TranslationCodeLensProvider.groupKey(g.startLine, endLine);
			const isFolded = this.foldedKeys.has(key);
			const range = new vscode.Range(g.startLine, 0, g.startLine, 0);

			if (isFolded) {
				lenses.push(new vscode.CodeLens(range, {
					title: `▸ ${g.prefix} [${g.count}]`,
					command: UNFOLD_COMMAND,
					arguments: [g.startLine, endLine, key],
				}));
			} else {
				lenses.push(new vscode.CodeLens(range, {
					title: `▾ ${g.prefix} [${g.count}]`,
					command: FOLD_COMMAND,
					arguments: [g.startLine, endLine, key],
				}));
			}
		}

		return lenses;
	}
}

export function activate(context: vscode.ExtensionContext) {
	// Code Lens（FoldingRangeProvider は登録しない）
	const codeLensProvider = new TranslationCodeLensProvider();
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider({ language: 'json' }, codeLensProvider)
	);

	// ドキュメントが編集されたときは行番号がずれる可能性があるため状態をリセット
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(() => {
			codeLensProvider.clearFoldedKeys();
			codeLensProvider.refresh();
		})
	);

	// fold コマンド:
	// 1. startLine〜endLine を選択
	// 2. editor.createFoldingRangeFromSelection で手動折りたたみ範囲を登録
	context.subscriptions.push(
		vscode.commands.registerCommand(
			FOLD_COMMAND,
			async (startLine: number, endLine: number, key: string) => {
				const editor = vscode.window.activeTextEditor;
				if (!editor) {
					return;
				}
				const startPos = new vscode.Position(startLine, 0);
				const endPos = new vscode.Position(
					endLine,
					editor.document.lineAt(endLine).text.length
				);
				editor.selection = new vscode.Selection(startPos, endPos);

				await vscode.commands.executeCommand('editor.createFoldingRangeFromSelection');
				// await vscode.commands.executeCommand('editor.fold', {
				// 	selectionLines: [startLine],
				// });

				codeLensProvider.markFolded(key);
			}
		)
	);

	// unfold コマンド:
	// 1. カーソルを startLine へ移動
	// 3. editor.removeManualFoldingRanges で手動範囲を削除
	context.subscriptions.push(
		vscode.commands.registerCommand(
			UNFOLD_COMMAND,
			async (startLine: number, _endLine: number, key: string) => {
				const editor = vscode.window.activeTextEditor;
				if (!editor) {
					return;
				}
				const pos = new vscode.Position(startLine, 0);
				editor.selection = new vscode.Selection(pos, pos);

				// await vscode.commands.executeCommand('editor.unfold', {
				// 	selectionLines: [startLine],
				// });
				await vscode.commands.executeCommand('editor.removeManualFoldingRanges');

				codeLensProvider.markUnfolded(key);
			}
		)
	);
}

export function deactivate() {}
