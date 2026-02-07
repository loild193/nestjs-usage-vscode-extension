import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ts from 'typescript';

// Mock vscode module
vi.mock('vscode', () => ({
    Uri: {
        file: (path: string) => ({ fsPath: path, path }),
        parse: (str: string) => ({ fsPath: str, path: str })
    },
    workspace: {
        findFiles: vi.fn().mockResolvedValue([]),
        openTextDocument: vi.fn().mockResolvedValue({
            getText: () => '',
            uri: { fsPath: '' }
        }),
        asRelativePath: (uri: { fsPath: string } | string) =>
            typeof uri === 'string' ? uri : uri.fsPath
    },
    Range: class Range {
        constructor(
            public start: { line: number; character: number },
            public end: { line: number; character: number }
        ) { }
    },
    Position: class Position {
        constructor(public line: number, public character: number) { }
    },
    window: {
        createOutputChannel: () => ({
            appendLine: vi.fn()
        })
    }
}));

import { ModuleGraphBuilder } from './moduleGraphBuilder';
import * as vscode from 'vscode';

describe('ModuleGraphBuilder', () => {
    let builder: ModuleGraphBuilder;
    let mockOutputChannel: vscode.OutputChannel;

    beforeEach(() => {
        mockOutputChannel = {
            appendLine: vi.fn()
        } as unknown as vscode.OutputChannel;
        builder = new ModuleGraphBuilder(mockOutputChannel);
    });

    describe('parseModuleFile', () => {
        it('should parse a simple module file', async () => {
            const moduleContent = `
import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [CommonModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService]
})
export class UserModule {}
`;

            vi.mocked(vscode.workspace.openTextDocument).mockResolvedValueOnce({
                getText: () => moduleContent,
                uri: { fsPath: '/app/user/user.module.ts' }
            } as unknown as vscode.TextDocument);

            const uri = vscode.Uri.file('/app/user/user.module.ts');
            const result = await builder.parseModuleFile(uri);

            expect(result).not.toBeNull();
            expect(result?.name).toBe('UserModule');
            expect(result?.imports).toContain('CommonModule');
            expect(result?.controllers).toContain('UserController');
            expect(result?.providers).toContain('UserService');
            expect(result?.exports).toContain('UserService');
        });

        it('should return null for non-module files', async () => {
            const serviceContent = `
import { Injectable } from '@nestjs/common';

@Injectable()
export class UserService {
  findAll() {
    return [];
  }
}
`;

            vi.mocked(vscode.workspace.openTextDocument).mockResolvedValueOnce({
                getText: () => serviceContent,
                uri: { fsPath: '/app/user/user.service.ts' }
            } as unknown as vscode.TextDocument);

            const uri = vscode.Uri.file('/app/user/user.service.ts');
            const result = await builder.parseModuleFile(uri);

            expect(result).toBeNull();
        });

        it('should handle empty module decorator', async () => {
            const moduleContent = `
import { Module } from '@nestjs/common';

@Module({})
export class EmptyModule {}
`;

            vi.mocked(vscode.workspace.openTextDocument).mockResolvedValueOnce({
                getText: () => moduleContent,
                uri: { fsPath: '/app/empty.module.ts' }
            } as unknown as vscode.TextDocument);

            const uri = vscode.Uri.file('/app/empty.module.ts');
            const result = await builder.parseModuleFile(uri);

            expect(result).not.toBeNull();
            expect(result?.name).toBe('EmptyModule');
            expect(result?.imports).toEqual([]);
            expect(result?.controllers).toEqual([]);
            expect(result?.providers).toEqual([]);
            expect(result?.exports).toEqual([]);
        });
    });

    describe('getModuleForFile', () => {
        it('should return module for files in same directory', async () => {
            // Setup mock module in graph
            const moduleContent = `
@Module({
  providers: [UserService]
})
export class UserModule {}
`;

            vi.mocked(vscode.workspace.findFiles).mockResolvedValueOnce([
                vscode.Uri.file('/app/user/user.module.ts')
            ]);

            vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue({
                getText: () => moduleContent,
                uri: { fsPath: '/app/user/user.module.ts' }
            } as unknown as vscode.TextDocument);

            await builder.buildGraph();

            const module = builder.getModuleForFile('/app/user/user.service.ts');
            expect(module?.name).toBe('UserModule');
        });
    });

    describe('getAccessibleModules', () => {
        it('should return module itself and importing modules', async () => {
            // Create a scenario with UserModule imported by AppModule
            const userModuleContent = `
@Module({
  exports: [UserService]
})
export class UserModule {}
`;

            const appModuleContent = `
@Module({
  imports: [UserModule]
})
export class AppModule {}
`;

            vi.mocked(vscode.workspace.findFiles).mockResolvedValueOnce([
                vscode.Uri.file('/app/user/user.module.ts'),
                vscode.Uri.file('/app/app.module.ts')
            ]);

            vi.mocked(vscode.workspace.openTextDocument)
                .mockResolvedValueOnce({
                    getText: () => userModuleContent,
                    uri: { fsPath: '/app/user/user.module.ts' }
                } as unknown as vscode.TextDocument)
                .mockResolvedValueOnce({
                    getText: () => appModuleContent,
                    uri: { fsPath: '/app/app.module.ts' }
                } as unknown as vscode.TextDocument);

            await builder.buildGraph();

            const accessible = builder.getAccessibleModules('UserModule');
            expect(accessible.has('UserModule')).toBe(true);
            expect(accessible.has('AppModule')).toBe(true);
        });
    });

    describe('clear', () => {
        it('should clear the module graph', async () => {
            const moduleContent = `
@Module({})
export class TestModule {}
`;

            vi.mocked(vscode.workspace.findFiles).mockResolvedValueOnce([
                vscode.Uri.file('/app/test.module.ts')
            ]);

            vi.mocked(vscode.workspace.openTextDocument).mockResolvedValueOnce({
                getText: () => moduleContent,
                uri: { fsPath: '/app/test.module.ts' }
            } as unknown as vscode.TextDocument);

            await builder.buildGraph();
            expect(builder.getGraph().size).toBeGreaterThan(0);

            builder.clear();
            expect(builder.getGraph().size).toBe(0);
        });
    });
});
