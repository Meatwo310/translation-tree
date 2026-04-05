import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const LOCALE_FILE_PATTERN = /^[a-z]{2}_[a-z]{2}\.json$/i;
const EN_US_FILENAME = 'en_us.json';

const decorationType = vscode.window.createTextEditorDecorationType({
	after: {
		color: new vscode.ThemeColor('editorCodeLens.foreground'),
		fontStyle: 'italic',
		margin: '0 0 0 1em',
	},
});

function updateDecorations(editor: vscode.TextEditor): void {
	const fileName = path.basename(editor.document.fileName);

	if (!LOCALE_FILE_PATTERN.test(fileName) || fileName.toLowerCase() === EN_US_FILENAME) {
		editor.setDecorations(decorationType, []);
		return;
	}

	const dir = path.dirname(editor.document.fileName);
	const enUsPath = path.join(dir, EN_US_FILENAME);

	if (!fs.existsSync(enUsPath)) {
		editor.setDecorations(decorationType, []);
		return;
	}

	let enUsData: Record<string, unknown>;
	try {
		enUsData = JSON.parse(fs.readFileSync(enUsPath, 'utf8'));
	} catch {
		editor.setDecorations(decorationType, []);
		return;
	}

	const decorations: vscode.DecorationOptions[] = [];

	for (let i = 0; i < editor.document.lineCount; i++) {
		const line = editor.document.lineAt(i);
		// キー行を検出: "key": ...
		const match = /^\s*"((?:[^"\\]|\\.)*)"\s*:/.exec(line.text);
		if (!match) {
			continue;
		}

		const key = JSON.parse(`"${match[1]}"`);
		const enValue = enUsData[key];

		if (typeof enValue === 'string') {
			decorations.push({
				range: line.range,
				renderOptions: {
					after: { contentText: enValue },
				},
			});
		}
	}

	editor.setDecorations(decorationType, decorations);
}

export function activate(context: vscode.ExtensionContext) {
	if (vscode.window.activeTextEditor) {
		updateDecorations(vscode.window.activeTextEditor);
	}

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) {
				updateDecorations(editor);
			}
		}),
		vscode.workspace.onDidChangeTextDocument(event => {
			const editor = vscode.window.activeTextEditor;
			if (editor && event.document === editor.document) {
				updateDecorations(editor);
			}
		}),
		vscode.workspace.onDidSaveTextDocument(() => {
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				updateDecorations(editor);
			}
		}),
	);
}

export function deactivate() {
	decorationType.dispose();
}
