# Model Routing and Tuning Guide

Daedalus features an embedded model router that manages routing logic, health checks, rate limiting, and hardware tuning across multiple local and remote LLM endpoints.

---

## Router Configuration

Configuration is located under the `"router"` object in `~/.daedalus/config.json`.

```json
{
  "router": {
    "strategy": "priority",
    "chain": [
      {
        "name": "lmstudio-default",
        "endpoint": "http://localhost:1234/v1",
        "model": "auto",
        "priority": 1,
        "enabled": true,
        "supportsTools": true,
        "tier": "intelligence"
      },
      {
        "name": "ollama-default",
        "endpoint": "http://localhost:11434/v1",
        "model": "auto",
        "priority": 2,
        "enabled": true,
        "supportsTools": true,
        "tier": "standard"
      }
    ],
    "healthCheckInterval": 30000,
    "requestTimeout": 120000
  }
}
```

### Routing Strategies

1.  **Priority**: Routes all requests to the first enabled and healthy model in the chain. Falls back to subsequent models if a higher-priority model is unhealthy or rate-limited.
2.  **Round-Robin**: Cycles requests evenly across all enabled and healthy models in the chain.
3.  **Fastest**: Tracks latency metrics dynamically using background health checks and routes to the model with the fastest response time.

---

## Proactive Model Routing & Tiers

Models can be classified into specific tiers in the configuration:

*   **Tiers**: `"fast"`, `"intelligence"`, or `"standard"`.
*   **Automatic Tier Detection**: 
    *   Simple or quick requests automatically route to `"fast"` tier models.
    *   Large coding contexts (estimated tokens > 8k) or agent subtasks automatically target `"intelligence"` tier models.
*   **Tool Filtering**: Sub-agents requiring tool use automatically filter and route to endpoints where `"supportsTools": true` is enabled.

---

## Local LLM Tuning & Hardware Guidelines

Running local models on consumer hardware (such as an **8GB VRAM GPU** and **32GB System RAM**) requires careful configuration to prevent performance bottlenecks.

### Context Length Optimization (LM Studio)

*   **The Pitfall**: Modern local models (such as Qwen2.5-Coder or Llama 3) default to a 32k context length. Attempting to process a 32k context window on an 8GB VRAM GPU causes the model state to spill over into system RAM (CPU fallback). This results in extremely slow processing times (minutes per turn), connection hangs, and CLI timeouts.
*   **The Solution**: In LM Studio (under Hardware Settings / Model Settings), set the **Context Length** limit to **8192** (8k). Restricting the context length keeps the processing entirely within VRAM, resulting in near-instant generation times and stable connections.

### Recommended Models for 8GB VRAM / 32GB RAM

1.  **Qwen2.5-Coder-7B-Instruct** (GGUF, using `Q4_K_M` or `Q5_K_M` quantization)
    *   *Recommended Use*: Code generation and editing. Highly accurate for TypeScript, Python, Go, and Rust.
2.  **Llama-3-8B-Instruct** (GGUF, using `Q4_K_M` or `Q5_K_M` quantization)
    *   *Recommended Use*: General chat, planning, and multi-agent orchestration.
