import * as vscode from 'vscode'

/**
 * Represents a NestJS module with its metadata
 */
export interface NestModule {
    name: string
    filePath: string
    imports: string[]
    exports: string[]
    providers: string[]
    controllers: string[]
}

/**
 * Represents a usage location in the codebase
 */
export interface UsageLocation {
    uri: vscode.Uri
    range: vscode.Range
    preview: string
    moduleName?: string
}

/**
 * Represents a symbol definition
 */
export interface SymbolDefinition {
    name: string
    uri: vscode.Uri
    range: vscode.Range
    kind: SymbolKind
    containerName?: string
    moduleName?: string
}

/**
 * Symbol kinds for NestJS elements
 */
export enum SymbolKind {
    Class = 'class',
    Method = 'method',
    Property = 'property',
    Function = 'function',
    Injectable = 'injectable',
    Controller = 'controller',
    Module = 'module',
}

/**
 * Module graph node for dependency tracking
 */
export interface ModuleGraphNode {
    module: NestModule
    importedBy: Set<string>
    imports: Set<string>
}

/**
 * Cache entry for parsed file results
 */
export interface CacheEntry<T> {
    data: T
    fileHash: string
    timestamp: number
}

/**
 * Configuration for the extension
 */
export interface ExtensionConfig {
    maxInlineUsages: number
    enableModuleScoping: boolean
    cacheSize: number
}
