import * as vscode from 'vscode'
import { NestJSHoverProvider } from './providers/hoverProvider'
import { NestJSDefinitionProvider } from './providers/definitionProvider'
import { NestJSAnalyzer } from './analyzer/nestjsAnalyzer'
import { IndexCache } from './cache/indexCache'
import { FileWatcher } from './cache/fileWatcher'
import { UsageLocation } from './types'

let analyzer: NestJSAnalyzer | undefined
let fileWatcher: FileWatcher | undefined
let lastHoverUsages: UsageLocation[] | undefined

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const outputChannel = vscode.window.createOutputChannel('NestJS Usage Finder')
    outputChannel.appendLine('NestJS Usage Finder is activating...')

    // Initialize cache and analyzer
    const config = vscode.workspace.getConfiguration('nestjsUsage')
    const cacheSize = config.get<number>('cacheSize', 100)
    const cache = new IndexCache(cacheSize)

    analyzer = new NestJSAnalyzer(cache, outputChannel)

    // Initialize file watcher for incremental updates
    fileWatcher = new FileWatcher(analyzer, cache, outputChannel)
    await fileWatcher.initialize()

    // Register hover provider with callback to capture usages for "Show All" command
    const hoverProvider = new NestJSHoverProvider(analyzer, config, (usages) => {
        lastHoverUsages = usages
    })
    context.subscriptions.push(
        vscode.languages.registerHoverProvider({ language: 'typescript', scheme: 'file' }, hoverProvider),
    )

    // Register definition provider
    const definitionProvider = new NestJSDefinitionProvider(analyzer)
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider({ language: 'typescript', scheme: 'file' }, definitionProvider),
    )

    // Register command for showing all usages
    context.subscriptions.push(
        vscode.commands.registerCommand('nestjs-usage.showAllUsages', async () => {
            // Use the cached usages from the last hover (more reliable than re-querying)
            const usages = lastHoverUsages
            if (!usages || usages.length === 0) {
                // Fallback: try to find usages from current cursor position
                const editor = vscode.window.activeTextEditor
                if (!editor) {
                    vscode.window.showWarningMessage('No active editor')
                    return
                }
                const position = editor.selection.active
                const document = editor.document
                const freshUsages = await analyzer?.findUsages(document, position)
                if (!freshUsages || freshUsages.length === 0) {
                    vscode.window.showInformationMessage('No usages found. Try hovering over a symbol first.')
                    return
                }
                lastHoverUsages = freshUsages
            }

            const displayUsages = lastHoverUsages!
            const items = displayUsages.map((usage) => ({
                label: `📄 ${vscode.workspace.asRelativePath(usage.uri)}`,
                description: `Line ${usage.range.start.line + 1}`,
                detail: usage.preview,
                usage,
            }))

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Found ${displayUsages.length} usage(s)`,
                matchOnDescription: true,
                matchOnDetail: true,
            })

            if (selected) {
                const doc = await vscode.workspace.openTextDocument(selected.usage.uri)
                const editor = await vscode.window.showTextDocument(doc)
                editor.selection = new vscode.Selection(selected.usage.range.start, selected.usage.range.end)
                editor.revealRange(selected.usage.range, vscode.TextEditorRevealType.InCenter)
            }
        }),
    )

    // Register disposables
    context.subscriptions.push(outputChannel, { dispose: () => fileWatcher?.dispose() })

    outputChannel.appendLine('NestJS Usage Finder activated successfully')
}

export function deactivate(): void {
    analyzer = undefined
    fileWatcher?.dispose()
}
