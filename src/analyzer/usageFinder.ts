import * as vscode from 'vscode';
import * as ts from 'typescript';
import { UsageLocation } from '../types';
import { ModuleGraphBuilder } from './moduleGraphBuilder';

/**
 * Exclusion patterns for directories that should not be scanned
 */
const EXCLUDED_PATTERNS = [
    '**/node_modules/**',
    '**/dist/**',
    '**/out/**',
    '**/build/**',
    '**/.git/**',
    '**/coverage/**'
];

/**
 * Finds usages of symbols scoped to NestJS module context
 */
export class UsageFinder {
    private outputChannel: vscode.OutputChannel;
    private moduleGraphBuilder: ModuleGraphBuilder;

    constructor(moduleGraphBuilder: ModuleGraphBuilder, outputChannel: vscode.OutputChannel) {
        this.moduleGraphBuilder = moduleGraphBuilder;
        this.outputChannel = outputChannel;
    }

    /**
     * Find all usages of a symbol at the given position
     * @param document The document containing the symbol
     * @param position The position of the symbol
     * @param enableModuleScoping Whether to limit search to module scope
     * @param containerName Optional container (class/object) name for precise matching
     */
    async findUsages(
        document: vscode.TextDocument,
        position: vscode.Position,
        enableModuleScoping: boolean,
        containerName?: string
    ): Promise<UsageLocation[]> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return [];
        }

        const symbolName = document.getText(wordRange);
        if (!symbolName) {
            return [];
        }

        // Detect if this is a property access (e.g., this.userRepository.create)
        // and get the container context
        const accessContext = this.getAccessContext(document, position);

        // Get the module context for scoping
        let scopeFiles: Set<string> | null = null;
        if (enableModuleScoping) {
            const currentModule = this.moduleGraphBuilder.getModuleForFile(document.uri.fsPath);
            if (currentModule) {
                scopeFiles = await this.getModuleScopeFiles(currentModule.name);
            }
        }

        // Find usages with context awareness
        const usages = await this.searchUsages(
            symbolName,
            scopeFiles,
            containerName || accessContext.containerName
        );

        this.outputChannel.appendLine(
            `Found ${usages.length} usages of "${accessContext.containerName ? accessContext.containerName + '.' : ''}${symbolName}"${enableModuleScoping ? ' (module-scoped)' : ''}`
        );

        return usages;
    }

    /**
     * Get the access context for a symbol (e.g., for `this.userRepo.create`, returns { containerName: 'userRepo' })
     */
    private getAccessContext(document: vscode.TextDocument, position: vscode.Position): { containerName?: string } {
        const line = document.lineAt(position.line).text;
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return {};
        }

        const charBefore = wordRange.start.character;
        const textBefore = line.substring(0, charBefore);

        // Check if this is a property access pattern: something.symbolName
        // Match patterns like: this.userRepository.create, userService.findOne, etc.
        const propertyAccessMatch = textBefore.match(/(\w+)\s*\.\s*$/);
        if (propertyAccessMatch) {
            const containerName = propertyAccessMatch[1];
            // Skip 'this' as container - look further back
            if (containerName === 'this') {
                const deeperMatch = textBefore.match(/this\s*\.\s*(\w+)\s*\.\s*$/);
                if (deeperMatch) {
                    return { containerName: deeperMatch[1] };
                }
                return {};
            }
            return { containerName };
        }

        return {};
    }

    /**
     * Get all files within a module's scope, excluding output directories
     */
    private async getModuleScopeFiles(moduleName: string): Promise<Set<string>> {
        const accessibleModules = this.moduleGraphBuilder.getAccessibleModules(moduleName);
        const files = new Set<string>();

        for (const modName of accessibleModules) {
            const node = this.moduleGraphBuilder.getGraph().get(modName);
            if (node) {
                // Add the module file itself (if not in excluded dir)
                if (!this.isExcludedPath(node.module.filePath)) {
                    files.add(node.module.filePath);
                }

                // Find all TypeScript files in the module's directory
                const moduleDir = vscode.Uri.file(node.module.filePath).with({
                    path: node.module.filePath.replace(/[^/\\]+$/, '')
                });

                const pattern = new vscode.RelativePattern(moduleDir, '**/*.ts');
                const moduleFiles = await vscode.workspace.findFiles(
                    pattern,
                    `{${EXCLUDED_PATTERNS.join(',')}}`
                );

                for (const file of moduleFiles) {
                    if (!this.isExcludedPath(file.fsPath)) {
                        files.add(file.fsPath);
                    }
                }
            }
        }

        return files;
    }

    /**
     * Check if a path should be excluded from scanning
     */
    private isExcludedPath(filePath: string): boolean {
        const excludedDirs = ['node_modules', 'dist', 'out', 'build', '.git', 'coverage'];
        return excludedDirs.some(dir => filePath.includes(`/${dir}/`) || filePath.includes(`\\${dir}\\`));
    }

    /**
     * Search for usages of a symbol name with optional container context
     */
    private async searchUsages(
        symbolName: string,
        scopeFiles: Set<string> | null,
        containerName?: string
    ): Promise<UsageLocation[]> {
        const usages: UsageLocation[] = [];

        // Get files to search
        let files: vscode.Uri[];
        if (scopeFiles) {
            files = Array.from(scopeFiles)
                .filter(f => !this.isExcludedPath(f))
                .map(f => vscode.Uri.file(f));
        } else {
            files = await vscode.workspace.findFiles(
                '**/*.ts',
                `{${EXCLUDED_PATTERNS.join(',')}}`
            );
        }

        // Process files in parallel with concurrency limit
        const CONCURRENCY = 10;
        for (let i = 0; i < files.length; i += CONCURRENCY) {
            const batch = files.slice(i, i + CONCURRENCY);
            const results = await Promise.all(
                batch.map(file => this.searchInFile(file, symbolName, containerName))
            );
            usages.push(...results.flat());
        }

        // Sort by file path and line number
        usages.sort((a, b) => {
            const pathCompare = a.uri.fsPath.localeCompare(b.uri.fsPath);
            if (pathCompare !== 0) return pathCompare;
            return a.range.start.line - b.range.start.line;
        });

        return usages;
    }

    /**
     * Search for usages in a single file with container context matching
     */
    private async searchInFile(
        uri: vscode.Uri,
        symbolName: string,
        containerName?: string
    ): Promise<UsageLocation[]> {
        const usages: UsageLocation[] = [];

        // Skip excluded paths
        if (this.isExcludedPath(uri.fsPath)) {
            return usages;
        }

        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const sourceText = document.getText();
            const sourceFile = ts.createSourceFile(
                uri.fsPath,
                sourceText,
                ts.ScriptTarget.Latest,
                true
            );

            const visit = (node: ts.Node): void => {
                if (ts.isIdentifier(node) && node.text === symbolName) {
                    // Skip if this is a declaration (we want usages, not definitions)
                    if (!this.isDeclaration(node)) {
                        // If containerName is specified, check if this usage matches the context
                        if (containerName) {
                            if (!this.matchesContainer(node, containerName)) {
                                return; // Skip - doesn't match the container context
                            }
                        }

                        const start = document.positionAt(node.getStart());
                        const end = document.positionAt(node.getEnd());
                        const line = document.lineAt(start.line);

                        usages.push({
                            uri,
                            range: new vscode.Range(start, end),
                            preview: line.text.trim()
                        });
                    }
                }
                ts.forEachChild(node, visit);
            };

            visit(sourceFile);
        } catch (error) {
            this.outputChannel.appendLine(`Error searching file ${uri.fsPath}: ${error}`);
        }

        return usages;
    }

    /**
     * Check if a usage matches the expected container (e.g., userRepository.create matches container "userRepository")
     */
    private matchesContainer(node: ts.Identifier, expectedContainer: string): boolean {
        const parent = node.parent;

        // Check if this is a property access expression: container.symbolName
        if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
            const expression = parent.expression;

            // Direct identifier: userRepository.create
            if (ts.isIdentifier(expression)) {
                return expression.text === expectedContainer;
            }

            // Property access: this.userRepository.create
            if (ts.isPropertyAccessExpression(expression)) {
                return expression.name.text === expectedContainer;
            }
        }

        // If no container context was found, and we're looking for a specific container,
        // don't match standalone usages
        return false;
    }

    /**
     * Check if a node is a declaration rather than a usage
     */
    private isDeclaration(node: ts.Identifier): boolean {
        const parent = node.parent;
        if (!parent) return false;

        // Class declaration
        if (ts.isClassDeclaration(parent) && parent.name === node) {
            return true;
        }

        // Method declaration
        if (ts.isMethodDeclaration(parent) && parent.name === node) {
            return true;
        }

        // Function declaration
        if (ts.isFunctionDeclaration(parent) && parent.name === node) {
            return true;
        }

        // Variable declaration
        if (ts.isVariableDeclaration(parent) && parent.name === node) {
            return true;
        }

        // Property declaration
        if (ts.isPropertyDeclaration(parent) && parent.name === node) {
            return true;
        }

        // Parameter declaration
        if (ts.isParameter(parent) && parent.name === node) {
            return true;
        }

        // Property assignment (in object literal)
        if (ts.isPropertyAssignment(parent) && parent.name === node) {
            return true;
        }

        return false;
    }
}
