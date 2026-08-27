const crypto = require("crypto");

const HK_TZ = "Asia/Hong_Kong";

function hashContent(content) {
  return crypto.createHash("sha256").update(content ?? "", "utf8").digest("hex");
}

function formatSnapshotStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: HK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}${get("hour")}${get("minute")}${get("second")}`;
}

function snapshotName(yamlName, versionNumber, date = new Date()) {
  return `${formatSnapshotStamp(date)}_${yamlName}_${versionNumber}`;
}

module.exports = { hashContent, snapshotName };
