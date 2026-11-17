# Repo Compass — Project v2 Plan

## v1 Overview

Repo Compass v1 helps developers explore unfamiliar GitHub repositories through an interactive file tree and TypeScript dependency graph. Users can inspect imports and importers, navigate between related files, and visualize how different parts of a codebase connect.

## User Testing Findings

I tested v1 with another user and observed an important usability gap: while the dependency graph successfully displayed relationships between files, the user had difficulty understanding what those relationships meant for exploring the repository.

For example, seeing that a file is imported by many other files does not necessarily explain why that file is important or whether it is a good place to start reading.

This revealed a gap between **visualizing code structure** and **helping users understand code structure**.

## Priorities for v2

### 1. Guided Repository Exploration (highest priority)

Introduce recommended starting points based on repository structure and dependency relationships.

Instead of only displaying which files are connected, Repo Compass would explain why certain files might be useful to explore and suggest a possible reading order.

**Goal:** Help users move from observing dependencies to making informed decisions about where to start.

### 2. Contextual Explanations

Add beginner-friendly explanations directly within the dependency graph and file details panel. For example, explain:

- the meaning of incoming and outgoing dependencies,
- why a file with many importers may be significant, and
- what a dependency cycle could indicate.

**Goal:** Make the existing visualization more understandable without requiring users to already know software architecture concepts.

### 3. File Search and Code Preview

Introduce file search and an integrated source code preview so users can locate relevant files and inspect their contents without repeatedly switching to GitHub.

**Goal:** Create a smoother exploration workflow, especially for larger repositories.

## Validation Plan

For v2, I would conduct another round of usability testing focused on whether users can independently:

- identify a useful entry point,
- explain a file's role in the repository, and
- navigate to related code.

I would prioritize improvements that help users complete these tasks with less confusion, rather than simply adding more technical features.

## Long-Term Direction

Future versions could expand dependency analysis to multiple levels, support additional languages, and improve monorepo support. However, the immediate priority is to make Repo Compass more useful and approachable for developers encountering an unfamiliar codebase.
