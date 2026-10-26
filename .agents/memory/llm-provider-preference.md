---
name: LLM provider preference
description: Product direction for prompt customization and model-provider support.
---

Keep resume generation user-directed through task-specific prompts. The user wants the app's LLM setup to be extensible to tokens from different providers, with Gemini as the initial provider.

**Why:** the user explicitly described this as a product requirement.

**How to apply:** keep provider implementations behind a server-side boundary, start with Gemini, and never expose provider credentials in browser code or chat.
