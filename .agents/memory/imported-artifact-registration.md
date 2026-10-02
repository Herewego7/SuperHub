---
name: Imported artifact registration
description: Handling imported artifact manifests that are not yet in the workspace registry.
---
Existing artifact manifests can be present on disk while the artifact registry and managed workflows remain empty. Passing their unchanged contents through the artifact manifest validation-and-replacement callback registers the existing artifacts and generates their managed workflows.

**Why:** Importing files alone did not register the services; scaffolding replacement apps would violate the requirement to preserve the imported project.

**How to apply:** When imported manifests exist but listArtifacts returns empty, validate and replace those manifests before creating artifacts or configuring manual replacement workflows.