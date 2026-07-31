document.body.classList.add('dark-mode');

document.addEventListener('DOMContentLoaded', () => {
  const promptGrid = document.getElementById('main-content');
  const searchInput = document.getElementById('searchInput');
  const tagFilters = document.getElementById('tagFilters');
  const modal = document.getElementById('editModal');
  const closeModal = document.getElementById('modalClose');
  const saveBtn = document.getElementById('modalSave');
  const previewPanel = document.getElementById('previewPanel');

  let prompts = [];
  let activeTags = new Set();

  async function fetchPrompts() {
    try {
      const response = await fetch('/api/prompts');
      prompts = await response.json();
      renderPrompts();
      renderTags();
    } catch (err) {
      console.error('Failed to fetch prompts:', err);
    }
  }

  function renderPrompts() {
    const searchTerm = searchInput.value.toLowerCase();
    const filtered = prompts.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchTerm) || 
                            p.tags.some(t => t.toLowerCase().includes(searchTerm));
      const matchesTags = activeTags.size === 0 || 
                          [...activeTags].every(t => p.tags.includes(t));
      return matchesSearch && matchesTags;
    });

    promptGrid.innerHTML = filtered.map(p => `
      <div class="prompt-card">
        <div class="prompt-card-header">
          <h3>${p.name}</h3>
        </div>
        <p class="prompt-card-description">${p.description}</p>
        <div class="prompt-card-tags">
          ${p.tags.map(t => `<span class="prompt-card-tag">${t}</span>`).join('')}
        </div>
        <div class="prompt-card-actions">
          <button class="btn btn-secondary" onclick="openPreview('${p.template.replace(/'/g, "\\'")}', '${p.name}')">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            Preview
          </button>
          <button class="btn btn-primary" onclick="copyToClipboard('${p.template.replace(/'/g, "\\'")}')">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            Copy
          </button>
        </div>
      </div>
    `).join('');
  }

  function renderTags() {
    const allTags = new Set();
    prompts.forEach(p => p.tags.forEach(t => allTags.add(t)));
    tagFilters.innerHTML = Array.from(allTags).map(t => `
      <button class="tag-pill ${activeTags.has(t) ? 'active' : ''}" onclick="toggleTag('${t}')">${t}</button>
    `).join('');
  }

  window.toggleTag = (tag) => {
    if (activeTags.has(tag)) activeTags.delete(tag);
    else activeTags.add(tag);
    renderPrompts();
    renderTags();
  };

  window.copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied to clipboard!');
    }).catch(err => {
      console.error('Copy failed', err);
      showToast('Copy failed');
    });
  };

// Open preview panel with template and name
window.openPreview = (template, name) => {
  const previewPanel = document.getElementById('previewPanel');
  const variablesForm = document.getElementById('variablesForm');
  const previewText = document.getElementById('previewText');
  // Clear previous inputs
  variablesForm.innerHTML = '';
  // Find variables in template {{var}}
  const varMatches = [...template.matchAll(/{{\s*(\w+)\s*}}/g)];
  const uniqueVars = [...new Set(varMatches.map(m => m[1]))];
  uniqueVars.forEach(v => {
    const group = document.createElement('div');
    group.className = 'variable-input-group';
    const label = document.createElement('label');
    label.textContent = v;
    label.htmlFor = `var-${v}`;
    const input = document.createElement('input');
    input.type = 'text';
    input.id = `var-${v}`;
    input.dataset.varName = v;
    input.addEventListener('input', updatePreview);
    group.appendChild(label);
    group.appendChild(input);
    variablesForm.appendChild(group);
  });
  // Store template for preview generation
  previewPanel.dataset.template = template;
  previewPanel.dataset.name = name;
  // Initial preview
  updatePreview();
  previewPanel.classList.add('active');
};

function updatePreview() {
  const previewPanel = document.getElementById('previewPanel');
  const template = previewPanel.dataset.template || '';
  let result = template;
  const inputs = previewPanel.querySelectorAll('input[data-var-name]');
  inputs.forEach(inp => {
    const varName = inp.dataset.varName;
    const value = inp.value || '';
    const regex = new RegExp(`{{\\s*${varName}\\s*}}`, 'g');
    result = result.replace(regex, value);
  });
  document.getElementById('previewText').textContent = result;
}

function copyPreviewToClipboard() {
  const text = document.getElementById('previewText').textContent;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Preview copied!');
  }).catch(err => {
    console.error('Copy preview failed', err);
    showToast('Copy failed');
  });
}

function showToast(message) {
  const toast = document.getElementById('toast');
  const msg = document.getElementById('toastMessage');
  msg.textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 3000);
}

  searchInput.addEventListener('input', renderPrompts);
  closeModal.addEventListener('click', () => modal.classList.remove('active'));
  
  // Add event listeners for modal controls
  document.getElementById('modalCancel').addEventListener('click', () => modal.classList.remove('active'));
  document.getElementById('modalSave').addEventListener('click', savePrompt);
  
  // Add event listeners for preview panel controls
  document.getElementById('previewClose').addEventListener('click', () => previewPanel.classList.remove('active'));
  document.getElementById('previewCancel').addEventListener('click', () => previewPanel.classList.remove('active'));
  document.getElementById('previewCopy').addEventListener('click', copyPreviewToClipboard);
  
  fetchPrompts();
});

// Save prompt function
function savePrompt() {
  const name = document.getElementById('promptName').value.trim();
  const tags = document.getElementById('promptTags').value.split(',').map(t => t.trim()).filter(t => t);
  const template = document.getElementById('promptTemplate').value.trim();
  const description = document.getElementById('promptDescription').value.trim();
  
  if (!name || !template) {
    showToast('Name and template are required');
    return;
  }
  
  const prompt = { name, tags, template, description };
  
  // In a real app, this would be an API call
  console.log('Saving prompt:', prompt);
  showToast('Prompt saved!');
  document.getElementById('editModal').classList.remove('active');
}
