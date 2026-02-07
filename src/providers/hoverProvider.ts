import * as vscode from 'vscode'
import { NestJSAnalyzer } from '../analyzer/nestjsAnalyzer'
import { UsageLocation } from '../types'

/**
 * Hover provider that displays usages and definitions on hover
 */
export class NestJSHoverProvider implements vscode.HoverProvider {
    private analyzer: NestJSAnalyzer
    private config: vscode.WorkspaceConfiguration
    private onUsagesFound?: (usages: UsageLocation[]) => void

    constructor(
        analyzer: NestJSAnalyzer,
        config: vscode.WorkspaceConfiguration,
        onUsagesFound?: (usages: UsageLocation[]) => void,
    ) {
        this.analyzer = analyzer
        this.config = config
        this.onUsagesFound = onUsagesFound
    }

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
    ): Promise<vscode.Hover | null> {
        const wordRange = document.getWordRangeAtPosition(position)
        if (!wordRange) {
            return null
        }

        const symbolName = document.getText(wordRange)
        if (!symbolName || symbolName.length < 2) {
            return null
        }

        // Skip common keywords
        const keywords = [
            'if',
            'else',
            'for',
            'while',
            'return',
            'const',
            'let',
            'var',
            'function',
            'class',
            'import',
            'export',
            'from',
            'async',
            'await',
            'true',
            'false',
            'null',
            'undefined',
            'this',
            'new',
            'throw',
            'try',
            'catch',
            'finally',
            'typeof',
            'instanceof',
        ]
        if (keywords.includes(symbolName)) {
            return null
        }

        const markdownContent = new vscode.MarkdownString()
        markdownContent.isTrusted = true
        markdownContent.supportHtml = true

        // Get definition
        const definition = await this.analyzer.findDefinition(document, position)
        if (definition) {
            const resolver = this.analyzer.getSymbolResolver()
            const icon = resolver.getKindIcon(definition.kind)
            const kindLabel = resolver.getKindLabel(definition.kind)

            markdownContent.appendMarkdown(`### ${icon} ${symbolName}\n\n`)
            markdownContent.appendMarkdown(`**${kindLabel}**`)
            if (definition.containerName) {
                markdownContent.appendMarkdown(` in \`${definition.containerName}\``)
            }
            markdownContent.appendMarkdown('\n\n')

            // Add definition link
            const defPath = vscode.workspace.asRelativePath(definition.uri)
            const defLine = definition.range.start.line + 1
            const defUri = definition.uri.with({ fragment: `L${defLine}` })
            markdownContent.appendMarkdown(`**Definition:** [${defPath}:${defLine}](${defUri})\n\n`)
        }

        // Get usages
        const allUsages = await this.analyzer.findUsages(document, position)
        if (allUsages.length > 0) {
            // Notify callback so "Show All" command can access these usages
            if (this.onUsagesFound) {
                this.onUsagesFound(allUsages)
            }

            const maxInline = this.config.get<number>('maxInlineUsages', 5)
            const displayUsages = allUsages.slice(0, maxInline)
            const hasMore = allUsages.length > maxInline

            // Get module context
            const moduleName = this.analyzer.getModuleForFile(document.uri.fsPath)
            if (moduleName) {
                markdownContent.appendMarkdown(`**Module:** \`${moduleName}\`\n\n`)
            }

            markdownContent.appendMarkdown(`**Usages** (${allUsages.length}):\n\n`)

            for (const usage of displayUsages) {
                const relativePath = vscode.workspace.asRelativePath(usage.uri)
                const line = usage.range.start.line + 1
                const usageUri = usage.uri.with({ fragment: `L${line}` })

                // Truncate preview if too long
                let preview = usage.preview
                if (preview.length > 60) {
                    preview = preview.substring(0, 57) + '...'
                }

                markdownContent.appendMarkdown(`- [${relativePath}:${line}](${usageUri}) — \`${preview}\`\n`)
            }

            if (hasMore) {
                markdownContent.appendMarkdown('\n---\n')
                const commandUri = vscode.Uri.parse(`command:nestjs-usage.showAllUsages`)
                markdownContent.appendMarkdown(`[📋 Show all ${allUsages.length} usages](${commandUri})`)
            }
        } else {
            markdownContent.appendMarkdown('*No usages found in current module scope*\n')
        }

        return new vscode.Hover(markdownContent, wordRange)
    }
}
