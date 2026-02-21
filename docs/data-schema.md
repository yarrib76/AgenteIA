# Data Schema (DB-Ready)

Este documento define la estructura tabular actual en JSON para migracion futura a base de datos.

## contacts
- source: `data/contacts.json`
- PK: `id` (uuid)
- columns:
  - `id` string
  - `name` string
  - `phone` string (unique)
  - `createdAt` datetime

## messages
- source: `data/messages.json`
- PK: `id` (uuid)
- FK logica:
  - `contactPhone` -> `contacts.phone` (o alias canonico)
- columns:
  - `id` string
  - `contactPhone` string (indexable)
  - `direction` enum(`in`,`out`)
  - `text` text
  - `status` string
  - `timestamp` datetime

## contact_aliases
- source: `data/contact_aliases.json`
- PK: `id` (uuid)
- FK:
  - `contactPhone` -> `contacts.phone`
- unique:
  - (`contactPhone`, `aliasPhone`)
- columns:
  - `id` string
  - `contactPhone` string
  - `aliasPhone` string
  - `createdAt` datetime
  - `updatedAt` datetime

## roles
- source: `data/roles.json`
- PK: `id` (uuid)
- columns:
  - `id` string
  - `name` string (unique)
  - `detail` text
  - `createdAt` datetime
  - `updatedAt` datetime nullable

## models
- source: `data/models.json`
- PK: `id` (uuid)
- columns:
  - `id` string
  - `name` string (unique, visible)
  - `provider` enum(`openai`,`deepseek`,`openai_compatible`)
  - `modelId` string (ID real de API)
  - `baseUrl` string nullable
  - `envKey` string (unique)
  - `createdAt` datetime
  - `updatedAt` datetime nullable

## agents
- source: `data/agents.json`
- PK: `id` (uuid)
- FK:
  - `roleId` -> `roles.id`
  - `modelId` -> `models.id`
- columns:
  - `id` string
  - `name` string (unique)
  - `roleId` string
  - `modelId` string
  - `createdAt` datetime
  - `updatedAt` datetime nullable

## tasks
- source: `data/tasks.json`
- PK: `id` (uuid)
- FK:
  - `agentId` -> `agents.id`
- columns:
  - `id` string
  - `agentId` string
  - `fileId` string nullable (`files.id`)
  - `taskPromptTemplate` text
  - `taskInput` text
  - `mergedPrompt` text
  - `status` string
  - `createdAt` datetime

## files
- source: `data/files.json`
- PK: `id` (uuid)
- columns:
  - `id` string
  - `originalName` string
  - `mimeType` string
  - `storedName` string
  - `relativePath` string
  - `sizeBytes` integer
  - `createdAt` datetime
