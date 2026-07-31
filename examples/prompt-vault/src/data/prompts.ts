export const seedPrompts: Prompt[] = [
  {
    id: '1',
    name: 'Coding Assistant',
    description: 'A prompt to help with coding tasks',
    template: 'Write a {{language}} function that {{task}} with {{additionalRequirements}}',
    tags: ['coding', 'function', 'algorithm'],
    category: 'Coding',
    variables: ['language', 'task', 'additionalRequirements']
  },
  {
    id: '2',
    name: 'Writing Assistant',
    description: 'A prompt to help with writing tasks',
    template: 'Write a {{tone}} {{length}} {{type}} about {{topic}} for {{audience}}',
    tags: ['writing', 'creative', 'content'],
    category: 'Writing',
    variables: ['tone', 'length', 'type', 'topic', 'audience']
  },
  {
    id: '3',
    name: 'Database Query Helper',
    description: 'A prompt to help generate database queries',
    template: 'Write a {{databaseType}} query to {{action}} {{tableName}} where {{conditions}}',
    tags: ['database', 'sql', 'query'],
    category: 'Database',
    variables: ['databaseType', 'action', 'tableName', 'conditions']
  },
  {
    id: '4',
    name: 'API Design Helper',
    description: 'A prompt to help design API endpoints',
    template: 'Design a {{method}} {{endpoint}} endpoint that {{purpose}} with {{parameters}} and returns {{response}}',
    tags: ['api', 'design', 'endpoint'],
    category: 'API',
    variables: ['method', 'endpoint', 'purpose', 'parameters', 'response']
  },
  {
    id: '5',
    name: 'Debugging Assistant',
    description: 'A prompt to help with debugging code',
    template: 'Help me debug this {{language}} code that is {{issue}}: {{codeSnippet}}',
    tags: ['debugging', 'troubleshooting', 'error'],
    category: 'Debugging',
    variables: ['language', 'issue', 'codeSnippet']
  }
];