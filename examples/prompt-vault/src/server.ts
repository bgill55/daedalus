import express, { Express, Request, Response } from 'express';
import path from 'path';
import { Prompt } from './interfaces';
import { seedPrompts } from './data/prompts';

/**
 * Returns the in‑memory array of seed prompts.
 */
export function getAllPrompts(): Prompt[] {
  // Return a shallow copy to prevent external mutation
  return [...seedPrompts];
}

/**
 * Filters prompts whose name or any tag includes the case‑insensitive query string.
 */
export function searchPrompts(query: string): Prompt[] {
  const lowered = query.trim().toLowerCase();
  if (!lowered) return getAllPrompts();
  return seedPrompts.filter((p) => {
    const nameMatch = p.name.toLowerCase().includes(lowered);
    const tagMatch = p.tags.some((t) => t.toLowerCase().includes(lowered));
    return nameMatch || tagMatch;
  });
}

/**
 * Finds a prompt by id, updates its template, and returns the updated prompt or null if not found.
 */
export function updatePromptTemplate(id: string, newTemplate: string): Prompt | null {
  const idx = seedPrompts.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  // Mutate the stored prompt (in‑memory store)
  seedPrompts[idx].template = newTemplate;
  return seedPrompts[idx];
}

/**
 * Initialise the Express application, register middleware, static file serving, and API routes.
 */
export function createApp(port: number): Express.Application {
  const app: Express.Application = express();

  // Middleware
  app.use(express.json());

  // Serve static assets from the public folder (relative to project root)
  const publicPath = path.join(process.cwd(), 'public');
  app.use(express.static(publicPath));

  // API routes
  app.get('/api/prompts', (_req: Request, res: Response) => {
    res.json(getAllPrompts());
  });

  app.post('/api/search', (req: Request, res: Response) => {
    const { query } = req.body as { query?: string };
    if (typeof query !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid query' });
    }
    const results = searchPrompts(query);
    res.json(results);
  });

  app.put('/api/prompts/:id/template', (req: Request, res: Response) => {
    const { id } = req.params;
    const { template } = req.body as { template?: string };
    if (typeof template !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid template' });
    }
    const updated = updatePromptTemplate(id, template);
    if (!updated) {
      return res.status(404).json({ error: 'Prompt not found' });
    }
    res.json(updated);
  });

  // Start listening (optional – caller may also listen)
  app.listen(port, () => {
    console.log(`PromptVault server listening on port ${port}`);
  });

  return app;
}

// If this file is executed directly, start the server on a default port.
if (require.main === module) {
  const DEFAULT_PORT = Number(process.env.PORT) || 3000;
  createApp(DEFAULT_PORT);
}