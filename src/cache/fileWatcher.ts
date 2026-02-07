import * as vscode from 'vscode';
import { NestJSAnalyzer } from '../analyzer/nestjsAnalyzer';
import { IndexCache } from './indexCache';

/**
 * File watcher that triggers incremental updates to the analyzer
 */
export class FileWatcher {
    private watcher: vscode.FileSystemWatcher | undefined;
    private analyzer: NestJSAnalyzer;
    private cache: IndexCache;
    private outputChannel: vscode.OutputChannel;
    private debounceTimers = new Map<string, NodeJS.Timeout>();
    private readonly DEBOUNCE_MS = 300;

    constructor(
        analyzer: NestJSAnalyzer,
        cache: IndexCache,
        outputChannel: vscode.OutputChannel
    ) {
        this.analyzer = analyzer;
        this.cache = cache;
        this.outputChannel = outputChannel;
    }

    /**
     * Initialize the file watcher
     */
    async initialize(): Promise<void> {
        // Watch all TypeScript files
        this.watcher = vscode.workspace.createFileSystemWatcher('**/*.ts');

        this.watcher.onDidChange(uri => this.handleFileChange(uri, 'changed'));
        this.watcher.onDidCreate(uri => this.handleFileChange(uri, 'created'));
        this.watcher.onDidDelete(uri => this.handleFileChange(uri, 'deleted'));

        this.outputChannel.appendLine('File watcher initialized');
    }

    /**
     * Handle file change events with debouncing
     */
    private handleFileChange(uri: vscode.Uri, event: 'changed' | 'created' | 'deleted'): void {
        // Skip node_modules
        if (uri.fsPath.includes('node_modules')) {
            return;
        }

        const fsPath = uri.fsPath;

        // Clear existing debounce timer
        const existingTimer = this.debounceTimers.get(fsPath);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Set new debounce timer
        const timer = setTimeout(() => {
            this.processFileChange(uri, event);
            this.debounceTimers.delete(fsPath);
        }, this.DEBOUNCE_MS);

        this.debounceTimers.set(fsPath, timer);
    }

    /**
     * Process a file change after debouncing
     */
    private async processFileChange(
        uri: vscode.Uri,
        event: 'changed' | 'created' | 'deleted'
    ): Promise<void> {
        const fsPath = uri.fsPath;
        this.outputChannel.appendLine(`File ${event}: ${fsPath}`);

        // Check if it's a module file
        const isModuleFile = fsPath.endsWith('.module.ts');

        if (isModuleFile) {
            // Rebuild entire module graph for module file changes
            await this.analyzer.rebuildModuleGraph();
        } else {
            // Just invalidate cache for regular file changes
            this.analyzer.invalidateFile(fsPath);
        }
    }

    /**
     * Dispose the file watcher
     */
    dispose(): void {
        // Clear all debounce timers
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();

        // Dispose the watcher
        this.watcher?.dispose();
        this.outputChannel.appendLine('File watcher disposed');
    }
}
