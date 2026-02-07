# NestJS Usage Finder

[![CI](https://github.com/your-org/nestjs-usage-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/nestjs-usage-extension/actions/workflows/ci.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/nestjs-tools.nestjs-usage-extension)](https://marketplace.visualstudio.com/items?itemName=nestjs-tools.nestjs-usage-extension)

A VS Code extension that displays usages and definitions of functions, classes, and objects on hover — **scoped to NestJS module context**. Inspired by JetBrains IntelliJ's usage finder.

![Demo](./docs/demo.gif)

## Features

### 🎯 Module-Scoped Usage Finding

Unlike generic "Find All References", this extension understands NestJS's module architecture:

- **Smart Scoping**: Only shows usages within the same NestJS module and modules that import it
- **No False Positives**: Avoids showing irrelevant usages from unrelated modules with identically-named methods

### 🔍 Rich Hover Information

When you hover over any symbol:

- **Definition**: Clickable link to jump to the symbol's definition
- **Symbol Type**: Shows if it's a class, method, @Injectable, @Controller, or @Module
- **Usages**: Up to 5 inline usages with file paths and line previews
- **"Show More"**: Button to open a QuickPick panel with all usages

### ⚡ Performance Optimized

Designed for large codebases:

- **LRU Caching**: Frequently accessed analysis results are cached
- **Incremental Updates**: File watcher only invalidates affected cache entries
- **Lazy Initialization**: Module graph is built on first usage
- **Parallel Processing**: Files are analyzed in parallel batches

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Press `Cmd+Shift+X` (Mac) or `Ctrl+Shift+X` (Windows/Linux)
3. Search for "NestJS Usage Finder"
4. Click Install

### From VSIX File

```bash
code --install-extension nestjs-usage-extension-0.0.1.vsix
```

## Usage

1. Open a NestJS project in VS Code
2. Navigate to any TypeScript file (`.ts`)
3. Hover over a function, class, or variable name
4. View the definition and usages in the hover tooltip
5. Click any link to navigate to that location
6. For methods with many usages, click "Show all X usages" to open the QuickPick panel

### Commands

| Command | Description |
|---------|-------------|
| `NestJS: Show All Usages` | Opens QuickPick with all usages of the symbol under cursor |

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `nestjsUsage.maxInlineUsages` | number | 5 | Maximum usages shown in hover tooltip |
| `nestjsUsage.enableModuleScoping` | boolean | true | Limit usages to NestJS module scope |
| `nestjsUsage.cacheSize` | number | 100 | Maximum cached analysis results |

## Requirements

- VS Code 1.85.0 or higher
- NestJS project with `@Module()` decorated classes
- TypeScript files (`.ts`)

## How It Works

### Module Detection

The extension parses all `*.module.ts` files and extracts:

```typescript
@Module({
  imports: [OtherModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService]
})
export class UserModule {}
```

### Scope Resolution

When you hover over a symbol in `UserService`:

1. Extension identifies `UserService` belongs to `UserModule`
2. Finds all modules that import `UserModule`
3. Searches for usages only in files within this scope
4. Returns scoped, relevant results

### Architecture

```
src/
├── extension.ts           # Entry point, registers providers
├── types.ts               # TypeScript interfaces
├── analyzer/
│   ├── nestjsAnalyzer.ts  # Main facade coordinating all analysis
│   ├── moduleGraphBuilder.ts  # Parses @Module() decorators
│   ├── usageFinder.ts     # Finds usages with module scoping
│   └── symbolResolver.ts  # Resolves definitions
├── providers/
│   ├── hoverProvider.ts   # Hover tooltip rendering
│   └── definitionProvider.ts  # Go-to-definition
└── cache/
    ├── indexCache.ts      # LRU cache implementation
    └── fileWatcher.ts     # Incremental file watching
```

## Development

### Prerequisites

- Node.js 20 LTS
- pnpm 9+

### Setup

```bash
# Clone the repository
git clone https://github.com/your-org/nestjs-usage-extension.git
cd nestjs-usage-extension

# Install dependencies
pnpm install

# Compile
pnpm run compile

# Run extension in development mode
# Press F5 in VS Code to launch Extension Development Host
```

### Scripts

| Script | Description |
|--------|-------------|
| `pnpm run compile` | Compile TypeScript to JavaScript |
| `pnpm run watch` | Watch mode for development |
| `pnpm run lint` | Run ESLint |
| `pnpm test` | Run unit tests |
| `pnpm run package` | Package extension as VSIX |

### Testing

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm run test:watch
```

### Debug

1. Open the project in VS Code
2. Press `F5` to launch Extension Development Host
3. Open a NestJS project in the new window
4. Set breakpoints in `dist/` files
5. View output in "NestJS Usage Finder" Output Channel

## CI/CD

### Continuous Integration

Every push and pull request triggers:
- Linting with ESLint
- Unit tests with Vitest
- Build verification
- VSIX package creation

### Publishing

| Branch | Action |
|--------|--------|
| `develop` | Publishes as **pre-release** version |
| `main` | Publishes as **stable** release |

Required secrets:
- `VSCE_PAT`: Azure DevOps Personal Access Token with Marketplace permissions

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Commit: `git commit -m 'Add my feature'`
6. Push: `git push origin feature/my-feature`
7. Open a Pull Request

## Troubleshooting

### Extension not activating

- Ensure you have a `.ts` file open
- Check the "NestJS Usage Finder" Output Channel for errors

### No usages found

- Verify your NestJS modules have `@Module()` decorators
- Check if `nestjsUsage.enableModuleScoping` is limiting scope too much
- Try disabling module scoping temporarily to see all usages

### Slow performance

- Increase `nestjsUsage.cacheSize` for larger projects
- Exclude unnecessary folders in `.gitignore`

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- Inspired by JetBrains IntelliJ IDEA's usage finder
- Built with VS Code Extension API
- Uses TypeScript Compiler API for AST parsing
