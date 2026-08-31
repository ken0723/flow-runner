export function listFiles() {
  return fetch("/api/files");
}

export function getFile(id) {
  return fetch(`/api/files/${id}`);
}

export function createFile(name, content) {
  return fetch("/api/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, content }),
  });
}

export function updateFile(id, content) {
  return fetch(`/api/files/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

export function deleteFile(id) {
  return fetch(`/api/files/${id}`, { method: "DELETE" });
}

export function listVersions(fileId) {
  return fetch(`/api/files/${fileId}/versions`);
}

export function getVersion(fileId, versionId) {
  return fetch(`/api/files/${fileId}/versions/${versionId}`);
}

export function deleteVersion(fileId, versionId) {
  return fetch(`/api/files/${fileId}/versions/${versionId}`, { method: "DELETE" });
}

export function rollbackFile(fileId, versionId) {
  return fetch(`/api/files/${fileId}/rollback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ versionId }),
  });
}
