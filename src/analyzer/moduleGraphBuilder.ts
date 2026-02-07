import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as path from 'path';
import { NestModule, ModuleGraphNode } from '../types';

/**
 * Builds a dependency graph of NestJS modules by parsing @Module() decorators
 */
export class ModuleGraphBuilder {
    private moduleGraph = new Map<string, ModuleGraphNode>();
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Build the module graph from all .module.ts files in the workspace
     */
    async buildGraph(): Promise<Map<string, ModuleGraphNode>> {
        this.moduleGraph.clear();

        const moduleFiles = await vscode.workspace.findFiles(
            '**/*.module.ts',
            '{**/node_modules/**,**/dist/**,**/out/**,**/build/**,**/.git/**}'
        );

        for (const file of moduleFiles) {
            try {
                const module = await this.parseModuleFile(file);
                if (module) {
                    this.moduleGraph.set(module.name, {
                        module,
                        importedBy: new Set(),
                        imports: new Set(module.imports)
                    });
                }
            } catch (error) {
                this.outputChannel.appendLine(`Error parsing module ${file.fsPath}: ${error}`);
            }
        }

        // Build reverse dependency map (importedBy)
        for (const [name, node] of this.moduleGraph) {
            for (const importedModule of node.imports) {
                const importedNode = this.moduleGraph.get(importedModule);
                if (importedNode) {
                    importedNode.importedBy.add(name);
                }
            }
        }

        this.outputChannel.appendLine(`Built module graph with ${this.moduleGraph.size} modules`);
        return this.moduleGraph;
    }

    /**
     * Parse a module file and extract @Module() decorator metadata
     */
    async parseModuleFile(uri: vscode.Uri): Promise<NestModule | null> {
        const document = await vscode.workspace.openTextDocument(uri);
        const sourceText = document.getText();
        const sourceFile = ts.createSourceFile(
            uri.fsPath,
            sourceText,
            ts.ScriptTarget.Latest,
            true
        );

        let moduleInfo: NestModule | null = null;

        const visit = (node: ts.Node): void => {
            if (ts.isClassDeclaration(node) && node.name) {
                const moduleDecorator = this.findModuleDecorator(node);
                if (moduleDecorator) {
                    moduleInfo = {
                        name: node.name.text,
                        filePath: uri.fsPath,
                        imports: this.extractArrayProperty(moduleDecorator, 'imports'),
                        exports: this.extractArrayProperty(moduleDecorator, 'exports'),
                        providers: this.extractArrayProperty(moduleDecorator, 'providers'),
                        controllers: this.extractArrayProperty(moduleDecorator, 'controllers')
                    };
                }
            }
            ts.forEachChild(node, visit);
        };

        visit(sourceFile);
        return moduleInfo;
    }

    /**
     * Find @Module() decorator on a class
     */
    private findModuleDecorator(node: ts.ClassDeclaration): ts.ObjectLiteralExpression | null {
        const decorators = ts.getDecorators(node);
        if (!decorators) return null;

        for (const decorator of decorators) {
            if (ts.isCallExpression(decorator.expression)) {
                const expression = decorator.expression;
                if (ts.isIdentifier(expression.expression) &&
                    expression.expression.text === 'Module') {
                    const arg = expression.arguments[0];
                    if (arg && ts.isObjectLiteralExpression(arg)) {
                        return arg;
                    }
                }
            }
        }
        return null;
    }

    /**
     * Extract array property values from @Module() decorator object
     */
    private extractArrayProperty(obj: ts.ObjectLiteralExpression, propertyName: string): string[] {
        const result: string[] = [];

        for (const prop of obj.properties) {
            if (ts.isPropertyAssignment(prop) &&
                ts.isIdentifier(prop.name) &&
                prop.name.text === propertyName) {

                if (ts.isArrayLiteralExpression(prop.initializer)) {
                    for (const element of prop.initializer.elements) {
                        if (ts.isIdentifier(element)) {
                            result.push(element.text);
                        }
                    }
                }
            }
        }

        return result;
    }

    /**
     * Get the module that contains a given file
     */
    getModuleForFile(filePath: string): NestModule | null {
        const dir = path.dirname(filePath);

        // First, check if this file IS a module file
        for (const [, node] of this.moduleGraph) {
            if (node.module.filePath === filePath) {
                return node.module;
            }
        }

        // Check if a provider/controller in any module matches this file
        const fileName = path.basename(filePath, '.ts');
        const className = this.fileNameToClassName(fileName);

        for (const [, node] of this.moduleGraph) {
            const moduleDir = path.dirname(node.module.filePath);

            // Check if file is in the same directory as the module
            if (dir === moduleDir || dir.startsWith(moduleDir + path.sep)) {
                // Check if the class is listed as a provider or controller
                if (node.module.providers.includes(className) ||
                    node.module.controllers.includes(className)) {
                    return node.module;
                }
            }
        }

        // Fallback: find module in closest parent directory
        for (const [, node] of this.moduleGraph) {
            const moduleDir = path.dirname(node.module.filePath);
            if (dir === moduleDir || dir.startsWith(moduleDir + path.sep)) {
                return node.module;
            }
        }

        return null;
    }

    /**
     * Get all modules that can access a given module (itself + modules that import it)
     */
    getAccessibleModules(moduleName: string): Set<string> {
        const accessible = new Set<string>();
        accessible.add(moduleName);

        const node = this.moduleGraph.get(moduleName);
        if (node) {
            for (const importer of node.importedBy) {
                accessible.add(importer);
            }
        }

        return accessible;
    }

    /**
     * Get files that belong to accessible modules
     */
    getAccessibleFiles(moduleName: string): Set<string> {
        const accessibleModules = this.getAccessibleModules(moduleName);
        const files = new Set<string>();

        for (const modName of accessibleModules) {
            const node = this.moduleGraph.get(modName);
            if (node) {
                files.add(node.module.filePath);
                // TODO: Add provider and controller files
            }
        }

        return files;
    }

    /**
     * Convert file name to class name (e.g., user.service -> UserService)
     */
    private fileNameToClassName(fileName: string): string {
        return fileName
            .split(/[.-]/)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join('');
    }

    /**
     * Get the current module graph
     */
    getGraph(): Map<string, ModuleGraphNode> {
        return this.moduleGraph;
    }

    /**
     * Clear the module graph
     */
    clear(): void {
        this.moduleGraph.clear();
    }
}
