export function checkYamlSyntax(yamlText) {
  try {
    jsyaml.load(yamlText ?? "");
    return { valid: true, error: null };
  } catch (err) {
    const mark = err.mark;
    return {
      valid: false,
      error: {
        message: err.reason || err.message || "Invalid YAML",
        line: typeof mark?.line === "number" ? mark.line + 1 : null,
        column: typeof mark?.column === "number" ? mark.column + 1 : null,
      },
    };
  }
}

export function starterGraph() {
  return {
    nodes: [
      { id: "start_1", type: "start", name: "pipeline", x: 72, y: 180 },
      { id: "command_1", type: "command", command: "echo hello", x: 360, y: 180 },
      { id: "end_1", type: "end", echo: "done", x: 648, y: 180 },
    ],
    edges: [
      { from: "start_1", to: "command_1" },
      { from: "command_1", to: "end_1" },
    ],
  };
}

export function graphToYaml(graph) {
  const start = (graph.nodes || []).find((node) => node.type === "start");
  const doc = {
    name: String(start?.name || "").trim() || "pipeline",
    nodes: (graph.nodes || []).map((node) => {
      const item = {
        id: node.id,
        type: node.type,
        x: Math.round(Number(node.x) || 0),
        y: Math.round(Number(node.y) || 0),
      };
      if (node.type === "start") item.name = node.name ?? "";
      if (node.type === "command") item.command = node.command ?? "";
      if (node.type === "end") item.echo = "done";
      return item;
    }),
    edges: (graph.edges || []).map((edge) => ({ from: edge.from, to: edge.to })),
  };
  return jsyaml.dump(doc, { indent: 2, lineWidth: 120, noRefs: true });
}

export function yamlToGraph(text, previous = { nodes: [] }) {
  let doc;
  try {
    doc = jsyaml.load(text ?? "");
  } catch {
    return { nodes: [], edges: [] };
  }

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { nodes: [], edges: [] };
  }

  const prevById = new Map((previous.nodes || []).map((node) => [node.id, node]));
  const nodesIn = Array.isArray(doc.nodes) ? doc.nodes : [];
  const nodes = [];
  const usedIds = new Set();

  for (const raw of nodesIn) {
    if (!raw || typeof raw !== "object") continue;
    const type = raw.type === "start" || raw.type === "command" || raw.type === "end" ? raw.type : null;
    if (!type) continue;

    let id = String(raw.id || "").trim() || `${type}_${nodes.length + 1}`;
    if (usedIds.has(id)) id = `${id}_${nodes.length + 1}`;
    usedIds.add(id);

    const prev = prevById.get(id);
    const node = {
      id,
      type,
      x: Number.isFinite(Number(raw.x))
        ? Number(raw.x)
        : Number.isFinite(prev?.x)
          ? prev.x
          : 72 + nodes.length * 288,
      y: Number.isFinite(Number(raw.y))
        ? Number(raw.y)
        : Number.isFinite(prev?.y)
          ? prev.y
          : 180,
    };
    if (type === "start") node.name = String(raw.name ?? doc.name ?? "");
    if (type === "command") node.command = String(raw.command ?? "");
    if (type === "end") node.echo = "done";
    nodes.push(node);
  }

  const ids = new Set(nodes.map((node) => node.id));
  const edges = [];
  for (const raw of Array.isArray(doc.edges) ? doc.edges : []) {
    if (!raw || typeof raw !== "object") continue;
    const from = String(raw.from || "");
    const to = String(raw.to || "");
    if (!ids.has(from) || !ids.has(to) || from === to) continue;
    if (edges.some((edge) => edge.from === from && edge.to === to)) continue;
    edges.push({ from, to });
  }

  return { nodes, edges };
}
