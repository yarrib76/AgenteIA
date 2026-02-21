const { randomUUID } = require("crypto");
const { normalizePhone } = require("./contacts.service");
const { getRepositories } = require("../../repositories/repository-provider");

function normalizeRows(raw) {
  // Formato nuevo esperado: [{ id, contactPhone, aliasPhone, createdAt, updatedAt }]
  if (Array.isArray(raw)) {
    return raw
      .map((row) => ({
        id: row.id || randomUUID(),
        contactPhone: normalizePhone(row.contactPhone),
        aliasPhone: normalizePhone(row.aliasPhone),
        createdAt: row.createdAt || new Date().toISOString(),
        updatedAt: row.updatedAt || row.createdAt || new Date().toISOString(),
      }))
      .filter((row) => row.contactPhone && row.aliasPhone && row.contactPhone !== row.aliasPhone);
  }

  // Compatibilidad con formato viejo objeto: { "contactPhone": ["alias1", "alias2"] }
  if (raw && typeof raw === "object") {
    const rows = [];
    for (const [contactPhone, aliasList] of Object.entries(raw)) {
      const canonical = normalizePhone(contactPhone);
      if (!canonical) continue;
      for (const alias of aliasList || []) {
        const aliasPhone = normalizePhone(alias);
        if (!aliasPhone || aliasPhone === canonical) continue;
        rows.push({
          id: randomUUID(),
          contactPhone: canonical,
          aliasPhone,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
    return rows;
  }

  return [];
}

async function readAliasRows() {
  const { contactAliases: aliasesRepo } = getRepositories();
  const raw = await aliasesRepo.list();
  return normalizeRows(raw);
}

async function writeAliasRows(rows) {
  const dedup = new Map();
  for (const row of rows) {
    const key = `${row.contactPhone}:${row.aliasPhone}`;
    if (!dedup.has(key)) dedup.set(key, row);
  }
  const { contactAliases: aliasesRepo } = getRepositories();
  await aliasesRepo.saveAll(Array.from(dedup.values()));
}

async function getAliases(phone) {
  const base = normalizePhone(phone);
  if (!base) return [];
  const rows = await readAliasRows();
  const list = rows
    .filter((row) => row.contactPhone === base)
    .map((row) => row.aliasPhone);
  return Array.from(new Set([base, ...list]));
}

async function addAliases(phone, keys) {
  const base = normalizePhone(phone);
  if (!base) return [];
  const rows = await readAliasRows();
  const normalizedKeys = Array.from(
    new Set((keys || []).map((value) => normalizePhone(value)).filter(Boolean))
  ).filter((value) => value !== base);

  for (const aliasPhone of normalizedKeys) {
    rows.push({
      id: randomUUID(),
      contactPhone: base,
      aliasPhone,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  await writeAliasRows(rows);
  return getAliases(base);
}

async function findCanonicalByAlias(aliasKey) {
  const target = normalizePhone(aliasKey);
  if (!target) return null;
  const rows = await readAliasRows();
  const match = rows.find((row) => row.aliasPhone === target || row.contactPhone === target);
  if (match) return match.contactPhone;
  return null;
}

module.exports = {
  getAliases,
  addAliases,
  findCanonicalByAlias,
};
