# Shortcut Command Documentation

The `/shortcut` command allows developers to create custom aliases for frequently used slash commands, improving workflow efficiency and reducing typing.

---

## Overview

Shortcuts enable you to define custom command aliases that resolve to existing Daedalus commands. For example, you can create `/shortcut qt = /test 1 -g` to quickly run tests with specific flags, or `/shortcut cg = /callgraph` for common callgraph operations.

---

## Usage

### List All Shortcuts

```
/shortcut
```

Displays all currently configured shortcuts with their aliases and target commands.

**Example Output:**
```
Active Shortcuts:
  qt  →  /test 1 -g
  cg  →  /callgraph
  lint → /test --lint
  build → /test --build
```

### Add a New Shortcut

```
/shortcut <alias> = <command>
```

Creates a new shortcut that maps your custom alias to an existing Daedalus command.

**Examples:**
```
/shortcut qt = /test 1 -g
/shortcut cg = /callgraph
/shortcut lint = /test --lint
/shortcut build = /test --build
/shortcut review = /pr review
```

### Remove a Shortcut

```
/shortcut <alias> --remove
```

Deletes the specified shortcut alias.

**Example:**
```
/shortcut qt --remove
```

---

## Syntax Rules

### Alias Requirements

- **Length**: 1-20 characters
- **Characters**: Alphanumeric, hyphens, and underscores only
- **Case-sensitive**: Aliases are case-sensitive
- **No conflicts**: Cannot override existing Daedalus commands

### Command Resolution

Shortcuts resolve to the underlying command when typed in the CLI:

```bash
# User types:
/qt

# System resolves to:
/test 1 -g
```

### Command Arguments

Shortcuts can include arguments that will be passed through to the target command:

```
/shortcut mytest = /test --project myapp --verbose
```

When you use `/mytest`, it executes `/test --project myapp --verbose`.

---

## Storage

Shortcuts are saved to:
- **Primary**: `.daedalus/shortcuts.json` (project-specific)
- **Fallback**: Global configuration (if project-specific not available)

The shortcuts file contains:
```json
{
  "shortcuts": {
    "qt": "/test 1 -g",
    "cg": "/callgraph",
    "lint": "/test --lint"
  }
}
```

---

## Examples

### Common Development Workflows

#### Testing Workflow
```bash
# Create shortcuts for common test commands
/shortcut qt = /test 1 -g
/shortcut all = /test
/shortcut watch = /test --watch

# Use them
/qt          # Runs test 1 with -g flag
/all         # Runs all tests
/watch       # Runs tests in watch mode
```

#### Code Analysis Workflow
```bash
# Create shortcuts for code analysis
/shortcut cg = /callgraph
/shortcut impact = /impact
/shortcut refs = /refs
/shortcut def = /def

# Use them
/cg          # Shows call graph
/impact      # Shows symbol impact
/refs        # Shows symbol references
/def         # Shows symbol definition
```

#### Git Workflow
```bash
# Create shortcuts for git operations
/shortcut commit = /commit
/shortcut branch = /branch
/shortcut pr = /pr
/shortcut status = /git status

# Use them
/commit      # Opens commit interface
/branch     # Manages branches
/pr         # Manages pull requests
```

### Custom Project Shortcuts

```bash
# Project-specific shortcuts
/shortcut deploy = /test --env production --deploy
/shortcut migrate = /test --env staging --migrate
/shortcut backup = /test --backup

# Use them
/deploy      # Deploys to production
/migrate     # Migrates staging environment
/backup      # Creates backup
```

---

## Best Practices

### 1. Keep Aliases Short and Memorable

Use intuitive, short aliases that are easy to type and remember:

```
# Good
git = /git status
lint = /test --lint
build = /test --build

# Avoid
git-operations = /git status --all --porcelain
complex-build-process = /test --env production --deploy --notify
```

### 2. Use Consistent Naming

Follow a consistent pattern for your shortcuts:

```bash
# Verb-based
/test = /test
/build = /test --build
/deploy = /test --deploy

# Project-specific
myapp-test = /test --project myapp
myapp-build = /test --project myapp --build
```

### 3. Document Your Shortcuts

Keep track of your shortcuts in your project documentation or README:

```markdown
## Common Shortcuts

- `/qt` - Run quick tests
- `/cg` - Show call graph
- `/lint` - Run linting
- `/build` - Build project
```

### 4. Override with Caution

Be careful when overriding existing commands:

```bash
# This will override the default /test command
shortcut test = /test --custom
```

### 5. Use Arguments Wisely

Include only necessary arguments in shortcuts. For complex commands, consider creating multiple shortcuts:

```bash
# Instead of:
/shortcut complex = /test --project myapp --env production --verbose --watch

# Use separate shortcuts:
/shortcut test-prod = /test --project myapp --env production
/shortcut test-watch = /test --watch
/shortcut test-verbose = /test --verbose
```

---

## Troubleshooting

### Shortcut Not Found

If a shortcut doesn't resolve:

1. **Check spelling**: Aliases are case-sensitive
2. **Verify existence**: Run `/shortcut` to list all shortcuts
3. **Check conflicts**: Ensure the alias doesn't conflict with existing commands

### Command Not Executing

If a shortcut resolves but the command fails:

1. **Check command syntax**: Ensure the target command is valid
2. **Verify arguments**: Check that arguments are properly formatted
3. **Restart CLI**: Sometimes changes require a CLI restart

### File Not Found

If shortcuts aren't being saved:

1. **Check permissions**: Ensure write access to `.daedalus/` directory
2. **Verify disk space**: Ensure sufficient disk space
3. **Check configuration**: Verify shortcuts are enabled in configuration

---

## Integration with Other Commands

### Using Shortcuts with `/orchestrate`

```bash
/orchestrate "Create a new feature" --shortcut qt
```

### Shortcut History

Some shortcuts can include history:

```bash
/shortcut recent = /test --last 5
```

### Context Preservation

Shortcuts preserve context when used in sequences:

```bash
/shortcut build
/shortcut test
/shortcut deploy
```

Each command maintains its own context and arguments.

---

## Advanced Features

### Dynamic Shortcuts

Create shortcuts that include dynamic values:

```bash
/shortcut today = /test --date $(date +%Y-%m-%d)
/shortcut branch = /test --branch $(git branch --show-current)
```

### Conditional Shortcuts

Use conditional logic in shortcuts:

```bash
/shortcut prod = /test --env production --dry-run
/shortcut dev = /test --env development
```

### Shortcut Groups

Organize shortcuts into logical groups:

```bash
/shortcut testing = /test
/shortcut analysis = /callgraph
/shortcut deployment = /deploy
```

Then use group commands:

```bash
/group testing
/group analysis
/group deployment
```

---

## Migration

### From Manual Commands

If you're currently using manual commands frequently:

1. **Identify patterns**: Look for commands you type repeatedly
2. **Create shortcuts**: Convert them to shortcuts
3. **Test thoroughly**: Verify each shortcut works as expected
4. **Document**: Update your project documentation

### From Other Tools

If migrating from other CLI tools:

```bash
# VS Code shortcuts
/shortcut vs = /test --vscode

# GitHub CLI shortcuts
/shortcut gh = /test --github

# Docker shortcuts
/shortcut docker = /test --docker
```

---

## See Also

- [`/config` command](configuration-reference.md) - Configure Daedalus settings
- [`/help` command](getting-started.md) - Get help for specific commands
- [`/orchestrate` command](orchestration.md) - Orchestrate complex tasks
- [`/test` command](configuration-reference.md) - Run tests
- [`/callgraph` command](configuration-reference.md) - Analyze code relationships

---

## Feedback

If you encounter issues with shortcuts or have suggestions for improvement:

1. **Report bugs**: Use the `/bug` command or contact support
2. **Request features**: Use the `/feature` command
3. **Share feedback**: Join the Daedalus community on Discord

---

*Last updated: July 29, 2026*