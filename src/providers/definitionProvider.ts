import * as vscode from 'vscode';
import { NestJSAnalyzer } from '../analyzer/nestjsAnalyzer';

/**
 * Definition provider for click-to-navigate functionality
 */
export class NestJSDefinitionProvider implements vscode.DefinitionProvider {
    private analyzer: NestJSAnalyzer;

    constructor(analyzer: NestJSAnalyzer) {
        this.analyzer = analyzer;
    }

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): Promise<vscode.Definition | null> {
        const definition = await this.analyzer.findDefinition(document, position);

        if (!definition) {
            return null;
        }

        return new vscode.Location(definition.uri, definition.range);
    }
}
