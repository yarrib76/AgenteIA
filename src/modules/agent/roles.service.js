const { randomUUID } = require("crypto");
const { getRepositories } = require("../../repositories/repository-provider");

async function listRoles() {
  const { roles: rolesRepo } = getRepositories();
  const roles = await rolesRepo.list();
  return roles.sort((a, b) => a.name.localeCompare(b.name, "es"));
}

async function createRole({ name, detail }) {
  const roleName = String(name || "").trim();
  const roleDetail = String(detail || "").trim();

  if (!roleName) throw new Error("El nombre del rol es obligatorio.");
  if (!roleDetail) throw new Error("El detalle del rol es obligatorio.");

  const { roles: rolesRepo } = getRepositories();
  const roles = await rolesRepo.list();
  const exists = roles.some(
    (r) => r.name.toLowerCase() === roleName.toLowerCase()
  );
  if (exists) throw new Error("Ya existe un rol con ese nombre.");

  const role = {
    id: randomUUID(),
    name: roleName,
    detail: roleDetail,
    createdAt: new Date().toISOString(),
  };

  roles.push(role);
  await rolesRepo.saveAll(roles);
  return role;
}

async function getRoleById(roleId) {
  const { roles: rolesRepo } = getRepositories();
  const roles = await rolesRepo.list();
  return roles.find((role) => role.id === roleId) || null;
}

async function updateRole(roleId, { name, detail }) {
  const roleName = String(name || "").trim();
  const roleDetail = String(detail || "").trim();

  if (!roleName) throw new Error("El nombre del rol es obligatorio.");
  if (!roleDetail) throw new Error("El detalle del rol es obligatorio.");

  const { roles: rolesRepo } = getRepositories();
  const roles = await rolesRepo.list();
  const index = roles.findIndex((role) => role.id === roleId);
  if (index < 0) throw new Error("Rol no encontrado.");

  const exists = roles.some(
    (role) =>
      role.id !== roleId &&
      role.name.toLowerCase() === roleName.toLowerCase()
  );
  if (exists) throw new Error("Ya existe un rol con ese nombre.");

  roles[index] = {
    ...roles[index],
    name: roleName,
    detail: roleDetail,
    updatedAt: new Date().toISOString(),
  };

  await rolesRepo.saveAll(roles);
  return roles[index];
}

async function deleteRole(roleId) {
  const { roles: rolesRepo } = getRepositories();
  const roles = await rolesRepo.list();
  const index = roles.findIndex((role) => role.id === roleId);
  if (index < 0) throw new Error("Rol no encontrado.");

  const [removed] = roles.splice(index, 1);
  await rolesRepo.saveAll(roles);
  return removed;
}

module.exports = {
  listRoles,
  createRole,
  getRoleById,
  updateRole,
  deleteRole,
};
