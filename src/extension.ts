import * as vscode from 'vscode';

// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// console.log('Congratulations, your extension "translation-tree" is now active!');

	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('translation-tree.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from translation-tree!');
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}
