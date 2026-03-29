const path = require("path");
const { readJson, writeJson } = require("../../modules/storage/json-file.service");

function createJsonDriver() {
  const files = {
    contacts: path.join(process.cwd(), "data", "contacts.json"),
    messages: path.join(process.cwd(), "data", "messages.json"),
    messagingSettings: path.join(process.cwd(), "data", "messaging_settings.json"),
    telegramChats: path.join(process.cwd(), "data", "telegram_chats.json"),
    internalConversations: path.join(process.cwd(), "data", "internal_conversations.json"),
    internalMessages: path.join(process.cwd(), "data", "internal_messages.json"),
    internalGroups: path.join(process.cwd(), "data", "internal_groups.json"),
    deviceTokens: path.join(process.cwd(), "data", "device_tokens.json"),
    mobileAuthTokens: path.join(process.cwd(), "data", "mobile_auth_tokens.json"),
    aliases: path.join(process.cwd(), "data", "contact_aliases.json"),
    roles: path.join(process.cwd(), "data", "roles.json"),
    agents: path.join(process.cwd(), "data", "agents.json"),
    models: path.join(process.cwd(), "data", "models.json"),
    tasks: path.join(process.cwd(), "data", "tasks.json"),
    files: path.join(process.cwd(), "data", "files.json"),
    taskReplyRoutes: path.join(process.cwd(), "data", "task_reply_routes.json"),
    apiIntegrations: path.join(process.cwd(), "data", "api_integrations.json"),
    users: path.join(process.cwd(), "data", "users.json"),
  };

  return {
    contacts: {
      list: () => readJson(files.contacts, []),
      insert: async (contact) => {
        const rows = await readJson(files.contacts, []);
        rows.push(contact);
        await writeJson(files.contacts, rows);
      },
      saveAll: (rows) => writeJson(files.contacts, rows),
    },
    messages: {
      list: () => readJson(files.messages, []),
      saveAll: (rows) => writeJson(files.messages, rows),
    },
    messagingSettings: {
      list: () => readJson(files.messagingSettings, []),
      saveAll: (rows) => writeJson(files.messagingSettings, rows),
    },
    telegramChats: {
      list: () => readJson(files.telegramChats, []),
      saveAll: (rows) => writeJson(files.telegramChats, rows),
    },
    internalConversations: {
      list: () => readJson(files.internalConversations, []),
      saveAll: (rows) => writeJson(files.internalConversations, rows),
    },
    internalMessages: {
      list: () => readJson(files.internalMessages, []),
      saveAll: (rows) => writeJson(files.internalMessages, rows),
    },
    internalGroups: {
      list: () => readJson(files.internalGroups, []),
      saveAll: (rows) => writeJson(files.internalGroups, rows),
    },
    deviceTokens: {
      list: () => readJson(files.deviceTokens, []),
      saveAll: (rows) => writeJson(files.deviceTokens, rows),
    },
    mobileAuthTokens: {
      list: () => readJson(files.mobileAuthTokens, []),
      saveAll: (rows) => writeJson(files.mobileAuthTokens, rows),
    },
    contactAliases: {
      list: () => readJson(files.aliases, []),
      saveAll: (rows) => writeJson(files.aliases, rows),
    },
    roles: {
      list: () => readJson(files.roles, []),
      saveAll: (rows) => writeJson(files.roles, rows),
    },
    agents: {
      list: () => readJson(files.agents, []),
      saveAll: (rows) => writeJson(files.agents, rows),
    },
    models: {
      list: () => readJson(files.models, []),
      saveAll: (rows) => writeJson(files.models, rows),
    },
    tasks: {
      list: () => readJson(files.tasks, []),
      saveAll: (rows) => writeJson(files.tasks, rows),
    },
    files: {
      list: () => readJson(files.files, []),
      saveAll: (rows) => writeJson(files.files, rows),
    },
    taskReplyRoutes: {
      list: () => readJson(files.taskReplyRoutes, []),
      saveAll: (rows) => writeJson(files.taskReplyRoutes, rows),
    },
    apiIntegrations: {
      list: () => readJson(files.apiIntegrations, []),
      saveAll: (rows) => writeJson(files.apiIntegrations, rows),
    },
    users: {
      list: () => readJson(files.users, []),
      saveAll: (rows) => writeJson(files.users, rows),
    },
  };
}

module.exports = {
  createJsonDriver,
};
