const internalChatGroupsService = require("../modules/internal-chat/internal-chat-groups.service");
const usersService = require("../modules/auth/users.service");

async function renderGroupsPage(req, res) {
  const [groups, users] = await Promise.all([
    internalChatGroupsService.listGroups(),
    usersService.listUsers(),
  ]);

  res.render("layouts/main", {
    pageTitle: "Grupos Internos",
    activeMenu: "internal-groups",
    headerTitle: "Grupos Internos",
    moduleView: "internal-groups",
    moduleData: {
      groups,
      users: users.map((user) => ({ id: user.id, email: user.email })),
    },
    pageScripts: ["/js/internal-groups.js"],
  });
}

async function listGroups(req, res) {
  const groups = await internalChatGroupsService.listGroups();
  res.json({ ok: true, groups });
}

async function createGroup(req, res) {
  try {
    const group = await internalChatGroupsService.createGroup({
      name: req.body.name,
      description: req.body.description,
      memberUserIds: req.body.memberUserIds,
      createdByUserId: req.currentUser ? req.currentUser.id : null,
    });
    res.status(201).json({ ok: true, group });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

async function updateGroup(req, res) {
  try {
    const group = await internalChatGroupsService.updateGroup(req.params.groupId, {
      name: req.body.name,
      description: req.body.description,
      memberUserIds: req.body.memberUserIds,
    });
    res.json({ ok: true, group });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

async function deleteGroup(req, res) {
  try {
    const deleted = await internalChatGroupsService.deleteGroup(req.params.groupId);
    res.json({ ok: true, deleted });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

module.exports = {
  renderGroupsPage,
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
};
