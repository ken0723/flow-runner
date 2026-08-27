const { hashContent, snapshotName } = require("./content-hash");

async function latestVersionHash(client, fileId) {
  const { rows } = await client.query(
    `SELECT content_hash
     FROM yaml_file_versions
     WHERE file_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [fileId]
  );
  return rows[0]?.content_hash ?? null;
}

async function snapshotCurrent(client, file) {
  const { rows: maxRows } = await client.query(
    `SELECT COALESCE(MAX(version_number), 0)::int AS max
     FROM yaml_file_versions
     WHERE file_id = $1`,
    [file.id]
  );
  const versionNumber = maxRows[0].max + 1;
  const contentHash = file.content_hash || hashContent(file.content);
  const name = snapshotName(file.name, versionNumber);
  const { rows } = await client.query(
    `INSERT INTO yaml_file_versions (file_id, version_number, name, content, content_hash)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, file_id, version_number, name, content_hash, created_at`,
    [file.id, versionNumber, name, file.content ?? "", contentHash]
  );
  return rows[0];
}

async function applyContentChange(client, file, incoming) {
  const hBefore = file.content_hash || hashContent(file.content ?? "");
  const hNew = hashContent(incoming);
  if (hNew === hBefore) {
    return { file: { ...file, content_hash: hBefore }, changed: false };
  }

  const lastHash = await latestVersionHash(client, file.id);
  if (!lastHash || lastHash !== hBefore) {
    await snapshotCurrent(client, { ...file, content_hash: hBefore });
  }

  const { rows } = await client.query(
    `UPDATE yaml_files
     SET content = $1, content_hash = $2, updated_at = NOW()
     WHERE id = $3
     RETURNING id, name, content, content_hash, updated_at`,
    [incoming, hNew, file.id]
  );
  return { file: rows[0], changed: true };
}

module.exports = { applyContentChange, snapshotCurrent };
