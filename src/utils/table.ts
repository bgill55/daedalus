import type { HealthPayload } from '../types/health.js';

export function formatHealthTable(payload: HealthPayload): string {
  const rows = Object.entries(payload.providers).map(([name, p]) => [
    capitalize(name),
    p.status,
    p.avgLatencyMs !== null ? `${p.avgLatencyMs} ms` : '—',
    p.apiKey,
  ]);

  // Append router strategy as a spanning row
  const table = buildTable({
    headers: ['Provider', 'Status', 'Avg Latency', 'API-Key'],
    rows,
    footer: [['Router Strategy', payload.routerStrategy, '', '']],
  });

  return table;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

interface BuildTableOptions {
  headers: string[];
  rows: string[][];
  footer?: string[][];
}

function buildTable(opts: BuildTableOptions): string {
  const { headers, rows, footer } = opts;
  
  // Calculate column widths
  const colWidths = headers.map((h, i) => {
    let maxLen = h.length;
    for (const row of rows) {
      if (row[i] && row[i].length > maxLen) {
        maxLen = row[i].length;
      }
    }
    if (footer) {
      for (const fRow of footer) {
        if (fRow[i] && fRow[i].length > maxLen) {
          maxLen = fRow[i].length;
        }
      }
    }
    return maxLen;
  });

  // Helper to pad a cell
  const padCell = (cell: string, width: number, align: 'left' | 'right' = 'left'): string => {
    const padding = width - cell.length;
    if (align === 'right') {
      return ' '.repeat(padding) + cell;
    }
    return cell + ' '.repeat(padding);
  };

  // Helper to create a separator line
  const createSeparator = (): string => {
    const parts = colWidths.map(w => '─'.repeat(w + 2)); // +2 for padding
    return '├' + parts.join('┼') + '┤';
  };

  // Helper to create a header/footer line
  const createLine = (cells: string[]): string => {
    const parts = cells.map((cell, i) => ` ${padCell(cell, colWidths[i])} `);
    return '│' + parts.join('│') + '│';
  };

  // Build the table
  let table = '';
  table += '┌' + colWidths.map(w => '─'.repeat(w + 2)).join('┬') + '┐\n';
  table += createLine(headers) + '\n';
  table += createSeparator() + '\n';
  
  for (const row of rows) {
    table += createLine(row) + '\n';
  }
  
  if (footer) {
    table += createSeparator() + '\n';
    for (const fRow of footer) {
      table += createLine(fRow) + '\n';
    }
  }
  
  table += '└' + colWidths.map(w => '─'.repeat(w + 2)).join('┴') + '┘';

  return table;
}
