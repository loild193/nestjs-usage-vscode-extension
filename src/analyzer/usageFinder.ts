import * as ts from 'typescript'
import * as vscode from 'vscode'
import { UsageLocation } from '../types'
import { ModuleGraphBuilder } from './moduleGraphBuilder'

/**
 * Exclusion patterns for directories that should not be scanned
 */
const EXCLUDED_PATTERNS = [
    '**/node_modules/**',
    '**/dist/**',
    '**/out/**',
    '**/build/**',
    '**/.git/**',
    '**/coverage/**',
]

/**
 * Finds usages of symbols scoped to NestJS module context
 */
export class UsageFinder {
    private outputChannel: vscode.OutputChannel
    private moduleGraphBuilder: ModuleGraphBuilder

    constructor(moduleGraphBuilder: ModuleGraphBuilder, outputChannel: vscode.OutputChannel) {
        this.moduleGraphBuilder = moduleGraphBuilder
        this.outputChannel = outputChannel
    }

    /**
     * Find all usages of a symbol at the given position
     * @param document The document containing the symbol
     * @param position The position of the symbol
     * @param enableModuleScoping Whether to limit search to module scope
     * @param containerClassName Optional container class name for precise matching
     */
    async findUsages(
        document: vscode.TextDocument,
        position: vscode.Position,
        enableModuleScoping: boolean,
        containerClassName?: string,
    ): Promise<UsageLocation[]> {
        const wordRange = document.getWordRangeAtPosition(position)
        if (!wordRange) {
            return []
        }

        const symbolName = document.getText(wordRange)
        if (!symbolName) {
            return []
        }

        // Detect if this is a property access and resolve the container's class type
        const containerClass = containerClassName || (await this.resolveContainerClass(document, position))

        // If no container class found but this is a method access, don't search
        if (!containerClass && this.isMethodAccess(document, position)) {
            this.outputChannel.appendLine(`Skipping search - method access without container class resolution`)
            return []
        }

        // Get the module context for scoping
        let scopeFiles: Set<string> | null = null
        if (enableModuleScoping) {
            const currentModule = this.moduleGraphBuilder.getModuleForFile(document.uri.fsPath)
            if (currentModule) {
                scopeFiles = await this.getModuleScopeFiles(currentModule.name)
            }
        }

        // Find usages with context awareness
        const usages = await this.searchUsages(symbolName, scopeFiles, containerClass)

        this.outputChannel.appendLine(
            `Found ${usages.length} usages of "${containerClass ? containerClass + '.' : ''}${symbolName}"${enableModuleScoping ? ' (module-scoped)' : ''}`,
        )

        return usages
    }

    /**
     * Check if the position is a method access (e.g., service.method)
     */
    private isMethodAccess(document: vscode.TextDocument, position: vscode.Position): boolean {
        const line = document.lineAt(position.line).text
        const wordRange = document.getWordRangeAtPosition(position)
        if (!wordRange) {
            return false
        }

        const charBefore = wordRange.start.character
        const textBefore = line.substring(0, charBefore)

        return /\w+\s*\.\s*$/.test(textBefore)
    }

    /**
     * Resolve the class type of the container for a property access
     * (e.g., for `userService.create`, resolve `userService` variable to `UserService` class)
     */
    private async resolveContainerClass(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): Promise<string | undefined> {
        const line = document.lineAt(position.line).text
        const wordRange = document.getWordRangeAtPosition(position)
        if (!wordRange) {
            return undefined
        }

        const charBefore = wordRange.start.character
        const textBefore = line.substring(0, charBefore)

        // Check if this is a property access pattern: something.symbolName
        const propertyAccessMatch = textBefore.match(/(\w+)\s*\.\s*$/)
        if (!propertyAccessMatch) {
            return undefined
        }

        let containerVarName = propertyAccessMatch[1]

        // Handle this.property.method pattern
        if (containerVarName === 'this') {
            const deeperMatch = textBefore.match(/this\s*\.\s*(\w+)\s*\.\s*$/)
            if (deeperMatch) {
                containerVarName = deeperMatch[1]
            } else {
                return undefined
            }
        }

        // Resolve the variable to its class type
        return this.resolveVariableType(document, containerVarName, position.line)
    }

    /**
     * Get all files within a module's scope, excluding output directories
     */
    private async getModuleScopeFiles(moduleName: string): Promise<Set<string>> {
        const accessibleModules = this.moduleGraphBuilder.getAccessibleModules(moduleName)
        const files = new Set<string>()

        for (const modName of accessibleModules) {
            const node = this.moduleGraphBuilder.getGraph().get(modName)
            if (node) {
                // Add the module file itself (if not in excluded dir)
                if (!this.isExcludedPath(node.module.filePath)) {
                    files.add(node.module.filePath)
                }

                // Find all TypeScript files in the module's directory
                const moduleDir = vscode.Uri.file(node.module.filePath).with({
                    path: node.module.filePath.replace(/[^/\\]+$/, ''),
                })

                const pattern = new vscode.RelativePattern(moduleDir, '**/*.ts')
                const moduleFiles = await vscode.workspace.findFiles(pattern, `{${EXCLUDED_PATTERNS.join(',')}}`)

                for (const file of moduleFiles) {
                    if (!this.isExcludedPath(file.fsPath)) {
                        files.add(file.fsPath)
                    }
                }
            }
        }

        return files
    }

    /**
     * Check if a path should be excluded from scanning
     */
    private isExcludedPath(filePath: string): boolean {
        const excludedDirs = ['node_modules', 'dist', 'out', 'build', '.git', 'coverage']
        return excludedDirs.some((dir) => filePath.includes(`/${dir}/`) || filePath.includes(`\\${dir}\\`))
    }

    /**
     * Search for usages of a symbol name with optional container class
     */
    private async searchUsages(
        symbolName: string,
        scopeFiles: Set<string> | null,
        containerClassName?: string,
    ): Promise<UsageLocation[]> {
        const usages: UsageLocation[] = []

        // Get files to search
        let files: vscode.Uri[]
        if (scopeFiles) {
            files = Array.from(scopeFiles)
                .filter((f) => !this.isExcludedPath(f))
                .map((f) => vscode.Uri.file(f))
        } else {
            files = await vscode.workspace.findFiles('**/*.ts', `{${EXCLUDED_PATTERNS.join(',')}}`)
        }

        // Process files in parallel with concurrency limit
        const CONCURRENCY = 10
        for (let i = 0; i < files.length; i += CONCURRENCY) {
            const batch = files.slice(i, i + CONCURRENCY)
            const results = await Promise.all(
                batch.map((file) => this.searchInFile(file, symbolName, containerClassName)),
            )
            usages.push(...results.flat())
        }

        // Sort by file path and line number
        usages.sort((a, b) => {
            const pathCompare = a.uri.fsPath.localeCompare(b.uri.fsPath)
            if (pathCompare !== 0) return pathCompare
            return a.range.start.line - b.range.start.line
        })

        return usages
    }

    /**
     * Search for usages in a single file with container class matching
     */
    private async searchInFile(
        uri: vscode.Uri,
        symbolName: string,
        containerClassName?: string,
    ): Promise<UsageLocation[]> {
        const usages: UsageLocation[] = []

        // Skip excluded paths
        if (this.isExcludedPath(uri.fsPath)) {
            return usages
        }

        try {
            const document = await vscode.workspace.openTextDocument(uri)
            const sourceText = document.getText()
            const sourceFile = ts.createSourceFile(uri.fsPath, sourceText, ts.ScriptTarget.Latest, true)

            const visit = (node: ts.Node): void => {
                if (ts.isIdentifier(node) && node.text === symbolName) {
                    // Skip if this is a declaration (we want usages, not definitions)
                    if (!this.isDeclaration(node)) {
                        // If containerClassName is specified, ONLY match method calls on that class
                        if (containerClassName) {
                            if (!this.matchesContainer(node, containerClassName, document)) {
                                return // Skip - doesn't match the container class
                            }
                        } else {
                            // If no container class, skip method access patterns
                            if (this.isMethodAccessNode(node)) {
                                return
                            }
                        }

                        const start = document.positionAt(node.getStart())
                        const end = document.positionAt(node.getEnd())
                        const line = document.lineAt(start.line)

                        usages.push({
                            uri,
                            range: new vscode.Range(start, end),
                            preview: line.text.trim(),
                        })
                    }
                }
                ts.forEachChild(node, visit)
            }

            visit(sourceFile)
        } catch (error) {
            this.outputChannel.appendLine(`Error searching file ${uri.fsPath}: ${error}`)
        }

        return usages
    }

    /**
     * Resolve a variable name to its class type by analyzing the source file
     */
    private resolveVariableType(
        document: vscode.TextDocument,
        variableName: string,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        beforeLine: number,
    ): string | undefined {
        const sourceText = document.getText()
        const sourceFile = ts.createSourceFile(document.uri.fsPath, sourceText, ts.ScriptTarget.Latest, true)

        let resolvedType: string | undefined

        const visit = (node: ts.Node): void => {
            if (resolvedType) return

            // Check constructor parameters (dependency injection)
            if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.name.text === variableName) {
                if (node.type && ts.isTypeReferenceNode(node.type) && ts.isIdentifier(node.type.typeName)) {
                    resolvedType = node.type.typeName.text
                    return
                }
            }

            // Check property declarations
            if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variableName) {
                if (node.type && ts.isTypeReferenceNode(node.type) && ts.isIdentifier(node.type.typeName)) {
                    resolvedType = node.type.typeName.text
                    return
                }
            }

            // Check variable declarations
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variableName) {
                if (node.type && ts.isTypeReferenceNode(node.type) && ts.isIdentifier(node.type.typeName)) {
                    resolvedType = node.type.typeName.text
                    return
                }
            }

            ts.forEachChild(node, visit)
        }

        visit(sourceFile)
        return resolvedType
    }

    /**
     * Check if a node is a method access (e.g., service.method)
     */
    private isMethodAccessNode(node: ts.Identifier): boolean {
        const parent = node.parent
        return ts.isPropertyAccessExpression(parent) && parent.name === node
    }

    /**
     * Check if a usage matches the expected container class
     */
    private matchesContainer(node: ts.Identifier, expectedClassName: string, document: vscode.TextDocument): boolean {
        const parent = node.parent

        // Must be a property access expression: container.symbolName
        if (!ts.isPropertyAccessExpression(parent) || parent.name !== node) {
            return false
        }

        const expression = parent.expression
        let variableName: string | undefined

        // Direct identifier: userService.create
        if (ts.isIdentifier(expression)) {
            variableName = expression.text
        }
        // Property access: this.userService.create
        else if (ts.isPropertyAccessExpression(expression)) {
            variableName = expression.name.text
        }

        if (!variableName) {
            return false
        }

        // Resolve the variable to its class type
        const className = this.resolveVariableType(
            document,
            variableName,
            parent.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line,
        )
        return className === expectedClassName
    }

    /**
     * Check if a node is a declaration rather than a usage
     */
    private isDeclaration(node: ts.Identifier): boolean {
        const parent = node.parent
        if (!parent) return false

        // Class declaration
        if (ts.isClassDeclaration(parent) && parent.name === node) {
            return true
        }

        // Method declaration
        if (ts.isMethodDeclaration(parent) && parent.name === node) {
            return true
        }

        // Function declaration
        if (ts.isFunctionDeclaration(parent) && parent.name === node) {
            return true
        }

        // Variable declaration
        if (ts.isVariableDeclaration(parent) && parent.name === node) {
            return true
        }

        // Property declaration
        if (ts.isPropertyDeclaration(parent) && parent.name === node) {
            return true
        }

        // Parameter declaration
        if (ts.isParameter(parent) && parent.name === node) {
            return true
        }

        // Property assignment (in object literal)
        if (ts.isPropertyAssignment(parent) && parent.name === node) {
            return true
        }

        return false
    }
}
