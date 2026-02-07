import * as vscode from 'vscode'
import { ModuleGraphBuilder } from './moduleGraphBuilder'
import { UsageFinder } from './usageFinder'
import { SymbolResolver } from './symbolResolver'
import { UsageLocation, SymbolDefinition } from '../types'
import { IndexCache } from '../cache/indexCache'

/**
 * Main analyzer facade that coordinates module graph building,
 * usage finding, and symbol resolution
 */
export class NestJSAnalyzer {
    private moduleGraphBuilder: ModuleGraphBuilder
    private usageFinder: UsageFinder
    private symbolResolver: SymbolResolver
    private cache: IndexCache
    private outputChannel: vscode.OutputChannel
    private isInitialized = false
    private initPromise: Promise<void> | null = null

    constructor(cache: IndexCache, outputChannel: vscode.OutputChannel) {
        this.cache = cache
        this.outputChannel = outputChannel
        this.moduleGraphBuilder = new ModuleGraphBuilder(outputChannel)
        this.usageFinder = new UsageFinder(this.moduleGraphBuilder, outputChannel)
        this.symbolResolver = new SymbolResolver(outputChannel)
    }

    /**
     * Initialize the analyzer by building the module graph
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) return
        if (this.initPromise) return this.initPromise

        this.initPromise = this.doInitialize()
        await this.initPromise
    }

    private async doInitialize(): Promise<void> {
        this.outputChannel.appendLine('Initializing NestJS Analyzer...')
        const startTime = Date.now()

        await this.moduleGraphBuilder.buildGraph()

        const elapsed = Date.now() - startTime
        this.outputChannel.appendLine(`Analyzer initialized in ${elapsed}ms`)
        this.isInitialized = true
    }

    /**
     * Find usages of the symbol at the given position
     */
    async findUsages(document: vscode.TextDocument, position: vscode.Position): Promise<UsageLocation[]> {
        await this.initialize()

        const config = vscode.workspace.getConfiguration('nestjsUsage')
        const enableModuleScoping = config.get<boolean>('enableModuleScoping', true)

        // Check cache first
        const cacheKey = `usages:${document.uri.fsPath}:${position.line}:${position.character}`
        const cached = this.cache.get<UsageLocation[]>(cacheKey)
        if (cached) {
            return cached
        }

        // Get the definition to extract container class if it's a method
        const definition = await this.symbolResolver.findDefinition(document, position)
        const containerClassName = definition?.containerName

        const usages = await this.usageFinder.findUsages(document, position, enableModuleScoping, containerClassName)

        // Cache results
        this.cache.set(cacheKey, usages)

        return usages
    }

    /**
     * Find the definition of the symbol at the given position
     */
    async findDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<SymbolDefinition | null> {
        await this.initialize()

        // Check cache first
        const cacheKey = `definition:${document.uri.fsPath}:${position.line}:${position.character}`
        const cached = this.cache.get<SymbolDefinition>(cacheKey)
        if (cached) {
            return cached
        }

        const definition = await this.symbolResolver.findDefinition(document, position)

        // Cache result
        if (definition) {
            this.cache.set(cacheKey, definition)
        }

        return definition
    }

    /**
     * Get the module that contains a file
     */
    getModuleForFile(filePath: string): string | null {
        const module = this.moduleGraphBuilder.getModuleForFile(filePath)
        return module?.name || null
    }

    /**
     * Invalidate cache for a file (called when file changes)
     */
    invalidateFile(filePath: string): void {
        this.cache.invalidateByPrefix(`usages:${filePath}`)
        this.cache.invalidateByPrefix(`definition:${filePath}`)
        this.outputChannel.appendLine(`Cache invalidated for: ${filePath}`)
    }

    /**
     * Rebuild the module graph (called when module files change)
     */
    async rebuildModuleGraph(): Promise<void> {
        this.outputChannel.appendLine('Rebuilding module graph...')
        await this.moduleGraphBuilder.buildGraph()
        this.cache.clear()
        this.outputChannel.appendLine('Module graph rebuilt')
    }

    /**
     * Get the symbol resolver for external use
     */
    getSymbolResolver(): SymbolResolver {
        return this.symbolResolver
    }
}
