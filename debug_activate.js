const fs = require("fs")
const path = require("path")
const extPath = path.join(__dirname, "dist", "extension.js")
const extCode = fs.readFileSync(extPath, "utf8")

const mockVscode = {
	commands: {
		registerCommand: (name, cb) => {
			console.log("REGISTER_COMMAND:", name)
			return { dispose: () => {} }
		},
		executeCommand: () => {},
	},
	workspace: {
		getConfiguration: () => ({ get: () => {} }),
		workspaceFolders: [],
		createFileSystemWatcher: () => ({
			onDidCreate: () => {},
			onDidChange: () => {},
			onDidDelete: () => {},
			dispose: () => {},
		}),
		onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
		fs: { stat: async () => ({}) },
		registerTextDocumentContentProvider: () => ({ dispose: () => {} }),
	},
	window: {
		createOutputChannel: () => ({ appendLine: () => {}, append: () => {} }),
		createTextEditorDecorationType: () => ({}),
		tabGroups: { all: [] },
		registerWebviewViewProvider: () => ({ dispose: () => {} }),
		registerUriHandler: () => ({ dispose: () => {} }),
	},
	languages: {
		registerCodeActionsProvider: () => ({ dispose: () => {} }),
	},
	extensions: { getExtension: () => null },
	env: { uriScheme: "vscode", uiKind: 1, machineId: "123" },
	Uri: {
		parse: (s) => ({ fsPath: s, toString: () => s }),
		from: () => ({ fsPath: "" }),
		file: (s) => ({ fsPath: s, toString: () => s }),
	},
	RelativePattern: class {},
	Disposable: class {},
	CodeActionKind: { QuickFix: 1, Refactor: 2, RefactorExtract: 3, RefactorRewrite: 4 },
	CodeAction: class {},
}

try {
	// Use a Function constructor to simulate a CommonJS environment
	const wrapper = new Function("require", "module", "exports", "__filename", "__dirname", "process", "console", extCode)
	const module = { exports: {} }
	const customRequire = (name) => {
		if (name === "vscode") return mockVscode
		try {
			return require(name)
		} catch (e) {
			return {}
		}
	}

	wrapper(customRequire, module, module.exports, extPath, path.dirname(extPath), process, console)
	console.log("Exports:", Object.keys(module.exports))
	if (module.exports.activate) {
		console.log("Found activate, calling it...")
		module.exports
			.activate({
				subscriptions: { push: () => {} },
				extension: { id: "test" },
				extensionUri: { fsPath: "" },
				globalStorageUri: { fsPath: "" },
				globalState: { get: () => {}, update: async () => {} },
				workspaceState: { get: () => {}, update: async () => {} },
				secrets: { get: async () => {}, store: async () => {}, onDidChange: () => ({ dispose: () => {} }) },
			})
			.then(() => console.log("Activate resolved"))
			.catch((e) => console.error("Activate failed:", e))
	}
} catch (e) {
	console.error("Eval failed:", e)
}
