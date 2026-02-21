# AgenteIA - Base Web Multi Agente

Proyecto Node.js modular con modulos:
- `Vincular Whatsapp`
- `Agenda`
- `Chat`
- `Agente (Nuevo Agente + Roles)`
- `Modelos`
- `Tareas`

## Estructura

- `src/routes/index.routes.js`: endpoints centralizados.
- `src/controllers/`: controladores por modulo.
- `src/modules/whatsapp/`: servicio y estado del modulo WhatsApp.
- `src/modules/agenda/`: persistencia de contactos en JSON.
- `src/modules/chat/`: persistencia de mensajes y chat.
- `src/modules/agent/`: persistencia de agentes y roles.
- `src/repositories/`: capa de acceso a datos (contratos + drivers).
- `views/layouts/main.ejs`: pantalla orquestadora principal.
- `views/modules/*.ejs`: vista por modulo.
- `public/`: CSS y JS cliente.
- `docs/data-schema.md`: esquema tabular pensado para migracion a BD.

## Requisitos

- Node.js 18+
- Google Chrome/Chromium (usado por `whatsapp-web.js`)

## Instalacion

1. Asegurar conectividad npm (si tienes proxy local invalido):
   - PowerShell temporal:
     - `$env:HTTP_PROXY=$null`
     - `$env:HTTPS_PROXY=$null`
2. Instalar dependencias:
   - `npm install`
3. Ejecutar:
   - `npm run dev`
4. Abrir:
   - `http://localhost:3000`

## Persistencia desacoplada

- El negocio usa repositorios via `src/repositories/repository-provider.js`.
- Driver actual: JSON (`STORAGE_DRIVER=json`, valor por defecto).
- Para migrar a DB se agrega un nuevo driver y se mantiene el contrato.

## Persistencia de vinculacion

La sesion de WhatsApp se guarda localmente en `.wwebjs_auth/` (no se borra al reiniciar la app).

## Persistencia de Agenda y Chat

- `data/contacts.json`: contactos.
- `data/messages.json`: historial reciente.
- `data/roles.json`: roles de agentes.
- `data/agents.json`: agentes creados.
- `data/models.json`: modelos registrados.
- `data/tasks.json`: tareas registradas.
- `data/files.json`: metadatos de archivos.

## Modulo Agente

- Submenu `Nuevo Agente`: alta y edicion de agentes (nombre + rol + modelo).
- Submenu `Roles`: ABM de roles (alta, baja y modificacion).

## Modulo Modelos

- Menu `Modelos` con ABM con campos:
  - Nombre (visible)
  - Proveedor (`openai`, `deepseek`, `openai_compatible`)
  - Model ID (ID real de API)
  - Base URL (solo para `openai_compatible`)
- Boton `Test` para enviar un mensaje y ver la respuesta del modelo.
- Sincroniza archivo `.env`:
  - alta: crea `NombreModelo_ApiKey=`
  - edicion: renombra la variable asociada
  - baja: elimina la variable asociada
- Test soporta:
  - `deepseek` -> `https://api.deepseek.com/chat/completions`
  - `openai` -> `https://api.openai.com/v1/chat/completions`
  - `openai_compatible` -> `${BaseURL}/chat/completions`

## Modulo Tareas

- Submenu `Tareas > Nueva`.
- ABM de tareas (alta, edicion, eliminacion).
- Formulario de tarea:
  - seleccion de agente
  - seleccion/subida de archivo de referencia (guardado en carpeta `archivos/`)
  - `taskPromptTemplate` (instruccion fija)
  - `taskInput` (dato variable de ejecucion)
- Guarda `mergedPrompt = promptRolAgente + taskPromptTemplate + taskInput + contexto de archivo (si aplica)`.
- Flujo manual:
  - `draft` -> `queued` (boton encolar)
  - `queued` -> `running/done/failed` (boton ejecutar)
- Registro por tarea:
  - `executionLogs` paso a paso
  - `executedActions`
  - `executionResult` y `executionError`
