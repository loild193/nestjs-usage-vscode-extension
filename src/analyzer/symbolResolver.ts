import * as vscode from 'vscode';
import * as ts from 'typescript';
import { SymbolDefinition, SymbolKind } from '../types';

/**
 * Resolves symbol definitions using TypeScript AST
 */
export class SymbolResolver {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Find the definition of a symbol at the given position
     */
    async findDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<SymbolDefinition | null> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return null;
        }

        const symbolName = document.getText(wordRange);
        if (!symbolName) {
            return null;
        }

        // First, try to find definition in the same file
        const localDef = this.findDefinitionInFile(document, symbolName);
        if (localDef) {
            return localDef;
        }

        // Search in workspace files (excluding output directories)
        const files = await vscode.workspace.findFiles(
            '**/*.ts',
            '{**/node_modules/**,**/dist/**,**/out/**,**/build/**,**/.git/**}'
        );

        for (const file of files) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const def = this.findDefinitionInFile(doc, symbolName);
                if (def) {
                    return def;
                }
            } catch {
                // Skip files that can't be opened
            }
        }

        return null;
    }

    /**
     * Find a symbol definition within a document
     */
    private findDefinitionInFile(
        document: vscode.TextDocument,
        symbolName: string
    ): SymbolDefinition | null {
        const sourceText = document.getText();
        const sourceFile = ts.createSourceFile(
            document.uri.fsPath,
            sourceText,
            ts.ScriptTarget.Latest,
            true
        );

        let definition: SymbolDefinition | null = null;

        const visit = (node: ts.Node): void => {
            if (definition) return; // Stop when found

            // Class declaration
            if (ts.isClassDeclaration(node) && node.name?.text === symbolName) {
                definition = this.createDefinition(document, node, symbolName, SymbolKind.Class);

                // Check for NestJS decorators
                const decorators = ts.getDecorators(node);
                if (decorators) {
                    for (const decorator of decorators) {
                        if (ts.isCallExpression(decorator.expression) &&
                            ts.isIdentifier(decorator.expression.expression)) {
                            const decoratorName = decorator.expression.expression.text;
                            if (decoratorName === 'Injectable') {
                                definition.kind = SymbolKind.Injectable;
                            } else if (decoratorName === 'Controller') {
                                definition.kind = SymbolKind.Controller;
                            } else if (decoratorName === 'Module') {
                                definition.kind = SymbolKind.Module;
                            }
                        }
                    }
                }
                return;
            }

            // Method declaration
            if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) &&
                node.name.text === symbolName) {
                const parent = node.parent;
                const containerName = ts.isClassDeclaration(parent) ? parent.name?.text : undefined;
                definition = this.createDefinition(
                    document, node, symbolName, SymbolKind.Method, containerName
                );
                return;
            }

            // Function declaration
            if (ts.isFunctionDeclaration(node) && node.name?.text === symbolName) {
                definition = this.createDefinition(document, node, symbolName, SymbolKind.Function);
                return;
            }

            // Variable declaration (for exported functions/constants)
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
                node.name.text === symbolName) {
                definition = this.createDefinition(document, node, symbolName, SymbolKind.Property);
                return;
            }

            // Property declaration in class
            if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name) &&
                node.name.text === symbolName) {
                const parent = node.parent;
                const containerName = ts.isClassDeclaration(parent) ? parent.name?.text : undefined;
                definition = this.createDefinition(
                    document, node, symbolName, SymbolKind.Property, containerName
                );
                return;
            }

            ts.forEachChild(node, visit);
        };

        visit(sourceFile);
        return definition;
    }

    /**
     * Create a SymbolDefinition from a TS node
     */
    private createDefinition(
        document: vscode.TextDocument,
        node: ts.Node,
        name: string,
        kind: SymbolKind,
        containerName?: string
    ): SymbolDefinition {
        const start = document.positionAt(node.getStart());
        const end = document.positionAt(node.getEnd());

        return {
            name,
            uri: document.uri,
            range: new vscode.Range(start, end),
            kind,
            containerName
        };
    }

    /**
     * Get a descriptive string for the symbol kind
     */
    getKindLabel(kind: SymbolKind): string {
        switch (kind) {
            case SymbolKind.Class: return 'class';
            case SymbolKind.Method: return 'method';
            case SymbolKind.Property: return 'property';
            case SymbolKind.Function: return 'function';
            case SymbolKind.Injectable: return 'injectable';
            case SymbolKind.Controller: return 'controller';
            case SymbolKind.Module: return 'module';
            default: return 'symbol';
        }
    }

    /**
     * Get an icon for the symbol kind (for display in markdown)
     */
    getKindIcon(kind: SymbolKind): string {
        switch (kind) {
            case SymbolKind.Class: return '🔷';
            case SymbolKind.Method: return '🔹';
            case SymbolKind.Property: return '🔸';
            case SymbolKind.Function: return '⚡';
            case SymbolKind.Injectable: return '💉';
            case SymbolKind.Controller: return '🎮';
            case SymbolKind.Module: return '📦';
            default: return '•';
        }
    }
}
