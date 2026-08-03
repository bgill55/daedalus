import readline from 'readline';
import { createLogger } from './logger.js';

// Persistent context storage for the REPL session
interface REPLContext {
  lastFile?: string;
  lastCommand?: string;
  history: string[];
  activeFiles: Set<string>;
}

export class REPL {
  private rl: readline.Interface;
  private context: REPLContext;
  private logger;

  constructor(_projectRoot: string = process.cwd()) {
    this.context = {
      history: [],
      activeFiles: new Set(),
    };
    this.logger = createLogger();

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'daedalus> ',
    });

    this.setupCommands();
    this.prompt();
  }

  private setupCommands(): void {
    this.rl.on('line', (input) => {
      const trimmed = input.trim();
      if (!trimmed) return;

      // Add to history
      this.context.history.push(trimmed);
      if (this.context.history.length > 50) {
        this.context.history.shift();
      }

      this.context.lastCommand = trimmed;
      this.executeCommand(trimmed);
    }).on('close', () => {
      this.logger.log('REPL session ended.');
      process.exit(0);
    });
  }

  private executeCommand(command: string): void {
    const parts = command.split(' ');
    const cmd = parts[0]!.toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case 'help':
        this.showHelp();
        break;
      case 'last':
        this.showLast();
        break;
      case 'edit':
        this.editFile(args[0]);
        break;
      case 'files':
        this.listActiveFiles();
        break;
      case 'clear':
        this.clearScreen();
        break;
      case 'history':
        this.showHistory();
        break;
      case 'context':
        this.showContext();
        break;
      default:
        this.logger.error(`Unknown command: ${command}. Type 'help' for available commands.`);
    }
  }

  private showHelp(): void {
    this.logger.log('Available commands:');
    this.logger.log('  help        - Show this help message');
    this.logger.log('  last        - Show last edited file and command');
    this.logger.log('  edit <file> - Open the specified file in your editor');
    this.logger.log('  files       - List active files in context');
    this.logger.log('  clear       - Clear screen');
    this.logger.log('  history     - Show command history');
    this.logger.log('  context     - Show current context');
    this.logger.log('  exit        - Exit REPL');
  }

  private showLast(): void {
    if (this.context.lastFile) {
      this.logger.log(`Last edited file: ${this.context.lastFile}`);
    }
    if (this.context.lastCommand) {
      this.logger.log(`Last command: ${this.context.lastCommand}`);
    }
  }

  private editFile(filePath?: string): void {
    if (!filePath) {
      this.logger.error('Please specify a file path: edit <file>');
      return;
    }

    this.context.lastFile = filePath;
    this.context.activeFiles.add(filePath);

    this.logger.log(`Opening ${filePath} in editor...`);
    
    // Try to detect common editors and open them
    const editor = this.detectEditor();
    if (editor) {
      this.logger.log(`Using editor: ${editor}`);
      // In a real implementation, you would spawn the editor here
      // For now, we just log what would happen
    } else {
      this.logger.log('Could not detect editor. Please open the file manually.');
    }
  }

  private detectEditor(): string | null {
    return 'code'; // VS Code as default assumption
  }

  private listActiveFiles(): void {
    if (this.context.activeFiles.size === 0) {
      this.logger.log('No active files.');
      return;
    }
    this.logger.log('Active files:');
    for (const file of this.context.activeFiles) {
      this.logger.log(`  - ${file}`);
    }
  }

  private clearScreen(): void {
    process.stdout.write('\x1b[2J\x1b[0f'); // ANSI clear screen
    this.logger.log('Screen cleared.');
  }

  private showHistory(): void {
    if (this.context.history.length === 0) {
      this.logger.log('No command history.');
      return;
    }
    this.logger.log('Command history:');
    this.context.history.forEach((cmd, idx) => {
      this.logger.log(`  ${idx + 1}. ${cmd}`);
    });
  }

  private showContext(): void {
    this.logger.log('=== REPL Context ===');
    this.logger.log(`History size: ${this.context.history.length}`);
    this.logger.log(`Active files: ${this.context.activeFiles.size}`);
    if (this.context.lastFile) {
      this.logger.log(`Last file: ${this.context.lastFile}`);
    }
    if (this.context.lastCommand) {
      this.logger.log(`Last command: ${this.context.lastCommand}`);
    }
  }

  public prompt(): void {
    this.rl.prompt();
  }

  public close(): void {
    this.rl.close();
  }
}

/**
 * Starts the interactive REPL environment
 */
export function startRepl(projectRoot: string = process.cwd()): REPL {
  const repl = new REPL(projectRoot);
  const logger = createLogger();
  logger.log('Daedalus REPL started. Type "help" for available commands.');
  return repl;
}

// Export for direct use
export default startRepl;
