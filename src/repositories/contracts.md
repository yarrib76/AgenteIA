# Repository Contracts

Este archivo documenta los contratos de persistencia para permitir cambiar de JSON a DB sin tocar logica de negocio.

## ContactsRepository
- `list(): Promise<ContactRow[]>`
- `insert(contact: ContactRow): Promise<void>`

## MessagesRepository
- `list(): Promise<MessageRow[]>`
- `saveAll(messages: MessageRow[]): Promise<void>`

## ContactAliasesRepository
- `list(): Promise<ContactAliasRow[]>`
- `saveAll(rows: ContactAliasRow[]): Promise<void>`

## RolesRepository
- `list(): Promise<RoleRow[]>`
- `saveAll(roles: RoleRow[]): Promise<void>`

## AgentsRepository
- `list(): Promise<AgentRow[]>`
- `saveAll(agents: AgentRow[]): Promise<void>`

## ModelsRepository
- `list(): Promise<ModelRow[]>`
- `saveAll(models: ModelRow[]): Promise<void>`

## TasksRepository
- `list(): Promise<TaskRow[]>`
- `saveAll(tasks: TaskRow[]): Promise<void>`

## TaskReplyRoutesRepository
- `list(): Promise<TaskReplyRouteRow[]>`
- `saveAll(rows: TaskReplyRouteRow[]): Promise<void>`

## FilesRepository
- `list(): Promise<FileRow[]>`
- `saveAll(files: FileRow[]): Promise<void>`

`Row` representa registro plano listo para mapear a tabla SQL.

## Campos sugeridos para TaskReplyRouteRow
- `id` (PK)
- `taskId` (FK a tarea)
- `sourcePhone` (origen que debe responder)
- `destinationContactId` (FK agenda)
- `destinationPhone` (destino de ruteo)
- `originalMessage` (ultimo mensaje enviado por la tarea)
- `lastOutboundMessageId` (ID de WhatsApp del ultimo mensaje saliente)
- `lastOutboundAt` (timestamp del ultimo mensaje saliente)
- `enabled` (boolean)
- `createdAt`
- `updatedAt`
