---
name: SuperHub isolation
description: Resource isolation required for SuperHub's setup and future configuration.
---
SuperHub is its own app. Do not use, copy, or connect the G-Cal-3 / Family Hub database, secrets, or deployment. Do not point VITE_API_BASE_URL at the Family Hub server.

**Why:** The user explicitly requires this project to be independent.

**How to apply:** Use this project's managed database and its own credentials. Preserve the separation during future setup, integrations, and publishing.