# Portable Recipes (`/recipe`)

Daedalus supports **Portable YAML Recipes**, allowing you to package complex, multi-step agent workflows into shareable `.yaml` files. Recipes can be checked into your project's git repository or saved globally in your user home directory.

---

## 📜 What is a Recipe?

A **Recipe** is a structured `.yaml` or `.json` file that defines:
- **`name`**: The unique identifier for the recipe.
- **`description`**: A summary of what the recipe accomplishes.
- **`role`**: *(Optional)* The targeted sub-agent role (e.g. `coder`, `reviewer`, `planner`, `debugger`).
- **`skills`**: *(Optional)* Array of active skill playbooks to inject.
- **`tools`**: *(Optional)* Array of tools allowed for the recipe run.
- **`prompt`**: The detailed multi-step instructions for the agent.

---

## 📁 Recipe File Locations & Built-in Defaults

Daedalus automatically resolves recipes in the following order:

1. **Project-Local Recipes**: `.daedalus/recipes/<name>.yaml` *(Checked into git for team sharing)*
2. **Global User Recipes**: `~/.daedalus/recipes/<name>.yaml` *(Available across all your projects)*
3. **Built-in Default Recipes**: Out-of-the-box system playbooks ready to run out of the box:
   - **`security-audit`**: Run security & diff immunity audit on code for type-loosening, error swallowing, and missing sanitization.
   - **`refactor-clean`**: Clean up redundant comments, unused imports, and dead variables while preserving tests.
   - **`spec-first-feature`**: Gather requirements and generate a SpecFirst contract (`.daedalus/spec.json` & `spec.md`).
   - **`bug-fix-triage`**: Diagnose error logs, isolate breaking symbols, and produce a minimal verified patch.

---

## 🛠️ Slash Command Usage

| Command | Description |
| :--- | :--- |
| `/recipe` or `/recipe list` | List all available project-local and global recipes |
| `/recipe run <name>` | Execute a recipe workflow by name |
| `/recipe create <name>` | Generate a starter `.yaml` template in `.daedalus/recipes/<name>.yaml` |

---

## ✍️ Example Recipe File

Create `.daedalus/recipes/security-audit.yaml`:

```yaml
name: security-audit
description: Run security and diff immunity audit on src/ directory
role: reviewer
skills: [security-audit, typescript-best-practices]
prompt: |
  Inspect the src/ directory and audit all recent changes for:
  1. Any type-loosening (converting interfaces to 'any').
  2. Any unhandled exceptions or empty catch blocks.
  3. Any hardcoded secrets or missing input sanitization.
  
  Provide a structured report with pass/fail status and recommended fixes.
```

---

## 🚀 Running a Recipe

To execute your security audit recipe, simply type:

```text
/recipe run security-audit
```

Daedalus will load the recipe, switch to the `reviewer` role, inject the specified skills, and execute the prompt turn with full tool support!
