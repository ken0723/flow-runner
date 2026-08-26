(function (global) {
  const NODE_WIDTH = 248;

  const ICONS = {
    start:
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 3.2v9.6L13 8 5 3.2Z" fill="currentColor"/></svg>',
    command:
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.2 4.8 6.4 8 3.2 11.2M8.2 11.6H12.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    end: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3.4" y="3.4" width="9.2" height="9.2" rx="1.6" fill="currentColor"/></svg>',
  };

  function uid(type, nodes) {
    const used = new Set(nodes.map((node) => node.id));
    let i = 1;
    while (used.has(`${type}_${i}`)) i += 1;
    return `${type}_${i}`;
  }

  function cloneGraph(graph) {
    return {
      nodes: (graph?.nodes || []).map((node) => ({ ...node })),
      edges: (graph?.edges || []).map((edge) => ({ ...edge })),
    };
  }

  function curveDx(x1, x2) {
    return Math.max(64, Math.abs(x2 - x1) * 0.45);
  }

  function bezier(x1, y1, x2, y2) {
    const dx = curveDx(x1, x2);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  function bezierMid(x1, y1, x2, y2) {
    const dx = curveDx(x1, x2);
    const t = 0.5;
    const u = 1 - t;
    const p1x = x1 + dx;
    const p2x = x2 - dx;
    return {
      x: u * u * u * x1 + 3 * u * u * t * p1x + 3 * u * t * t * p2x + t * t * t * x2,
      y: u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2,
    };
  }

  function create(options) {
    const root = options.el;
    const t = (key) => (options.t ? options.t(key) : key);

    let nodes = [];
    let edges = [];
    let panX = 40;
    let panY = 48;
    let zoom = 1;
    let selectedIds = new Set();
    let selectedEdge = null;
    let dragging = null;
    let connecting = null;
    let panning = null;
    let marquee = null;
    let past = [];
    let future = [];
    let fieldEditKey = null;

    root.classList.add("flow-canvas");
    root.innerHTML = `
      <div class="flow-viewport" tabindex="0">
        <div class="flow-empty" hidden>
          <p data-i18n-flow="nodes.empty"></p>
        </div>
        <div class="flow-world">
          <svg class="flow-wires" aria-hidden="true"></svg>
          <div class="flow-nodes"></div>
        </div>
        <div class="flow-marquee hidden" id="flow-marquee"></div>
      </div>
      <aside class="flow-palette">
        <span class="flow-palette-title" data-i18n-flow="nodes.palette"></span>
        <button type="button" class="flow-add" data-add="start">
          <span class="flow-add-icon is-start">${ICONS.start}</span>
          <span data-i18n-flow="nodes.start"></span>
        </button>
        <button type="button" class="flow-add" data-add="command">
          <span class="flow-add-icon is-command">${ICONS.command}</span>
          <span data-i18n-flow="nodes.command"></span>
        </button>
        <button type="button" class="flow-add" data-add="end">
          <span class="flow-add-icon is-end">${ICONS.end}</span>
          <span data-i18n-flow="nodes.end"></span>
        </button>
      </aside>
    `;

    const viewport = root.querySelector(".flow-viewport");
    const world = root.querySelector(".flow-world");
    const wiresEl = root.querySelector(".flow-wires");
    const nodesEl = root.querySelector(".flow-nodes");
    const emptyEl = root.querySelector(".flow-empty");
    const marqueeEl = root.querySelector(".flow-marquee");

    function emitChange() {
      options.onChange?.();
    }

    function snapshot() {
      return cloneGraph({ nodes, edges });
    }

    function restore(graph) {
      const next = cloneGraph(graph);
      nodes = next.nodes;
      edges = next.edges;
      selectedIds = new Set();
      selectedEdge = null;
      connecting = null;
      dragging = null;
      fieldEditKey = null;
      renderNodes();
    }

    function pushHistory(graph) {
      past.push(graph ? cloneGraph(graph) : snapshot());
      if (past.length > 80) past.shift();
      future = [];
    }

    function undo() {
      if (!past.length) return false;
      future.push(snapshot());
      restore(past.pop());
      emitChange();
      return true;
    }

    function redo() {
      if (!future.length) return false;
      past.push(snapshot());
      restore(future.pop());
      emitChange();
      return true;
    }

    function applyI18n() {
      root.querySelectorAll("[data-i18n-flow]").forEach((el) => {
        el.textContent = t(el.dataset.i18nFlow);
      });
      root.querySelectorAll("[data-i18n-flow-aria]").forEach((el) => {
        el.setAttribute("aria-label", t(el.dataset.i18nFlowAria));
      });
      root.querySelectorAll("[data-i18n-flow-placeholder]").forEach((el) => {
        el.setAttribute("placeholder", t(el.dataset.i18nFlowPlaceholder));
      });
    }

    function applyTransform() {
      world.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      viewport.style.backgroundSize = `${22 * zoom}px ${22 * zoom}px`;
      viewport.style.backgroundPosition = `${panX}px ${panY}px`;
    }

    function clientToWorld(clientX, clientY) {
      const rect = viewport.getBoundingClientRect();
      return {
        x: (clientX - rect.left - panX) / zoom,
        y: (clientY - rect.top - panY) / zoom,
      };
    }

    function portCenter(nodeId, side) {
      const port = nodesEl.querySelector(`[data-node-id="${nodeId}"] .flow-port-${side}`);
      if (!port) return null;
      const rect = port.getBoundingClientRect();
      const view = viewport.getBoundingClientRect();
      return {
        x: (rect.left + rect.width / 2 - view.left - panX) / zoom,
        y: (rect.top + rect.height / 2 - view.top - panY) / zoom,
      };
    }

    function drawWires() {
      const parts = [];
      for (const edge of edges) {
        const from = portCenter(edge.from, "out");
        const to = portCenter(edge.to, "in");
        if (!from || !to) continue;
        const key = `${edge.from}::${edge.to}`;
        const selected = selectedEdge === key ? " is-selected" : "";
        const d = bezier(from.x, from.y, to.x, to.y);
        const mid = bezierMid(from.x, from.y, to.x, to.y);
        const deleteLabel = escapeAttr(t("nodes.deleteEdge"));
        parts.push(`
          <g class="flow-wire${selected}" data-from="${edge.from}" data-to="${edge.to}">
            <path class="flow-wire-hit" d="${d}"></path>
            <path class="flow-wire-line" d="${d}"></path>
            <g class="flow-wire-delete" data-from="${edge.from}" data-to="${edge.to}">
              <title>${deleteLabel}</title>
              <circle class="flow-wire-delete-bg" cx="${mid.x}" cy="${mid.y}" r="9"></circle>
              <path class="flow-wire-delete-x" d="M ${mid.x - 3.2} ${mid.y - 3.2} L ${mid.x + 3.2} ${mid.y + 3.2} M ${mid.x + 3.2} ${mid.y - 3.2} L ${mid.x - 3.2} ${mid.y + 3.2}"></path>
            </g>
          </g>
        `);
      }
      if (connecting) {
        const origin = portCenter(connecting.nodeId, connecting.side);
        if (origin) {
          const d =
            connecting.side === "out"
              ? bezier(origin.x, origin.y, connecting.x, connecting.y)
              : bezier(connecting.x, connecting.y, origin.x, origin.y);
          parts.push(`
            <g class="flow-wire is-temp">
              <path class="flow-wire-line" d="${d}"></path>
            </g>
          `);
        }
      }
      wiresEl.innerHTML = parts.join("");
    }

    function nodeBody(node) {
      if (node.type === "start") {
        return `
          <label class="flow-field">
            <span data-i18n-flow="nodes.name"></span>
            <input
              type="text"
              spellcheck="false"
              autocomplete="off"
              data-field="name"
              data-i18n-flow-placeholder="nodes.namePlaceholder"
              value="${escapeAttr(node.name || "")}"
            />
          </label>
        `;
      }
      if (node.type === "command") {
        return `
          <label class="flow-field">
            <span data-i18n-flow="nodes.commandLabel"></span>
            <input
              type="text"
              spellcheck="false"
              autocomplete="off"
              data-field="command"
              data-i18n-flow-placeholder="nodes.commandPlaceholder"
              value="${escapeAttr(node.command || "")}"
            />
          </label>
        `;
      }
      return `
        <div class="flow-echo">
          <span class="flow-echo-prompt">$</span>
          <code>echo done</code>
        </div>
      `;
    }

    function renderNode(node) {
      const el = document.createElement("article");
      el.className = `flow-node is-${node.type}`;
      el.dataset.nodeId = node.id;
      if (selectedIds.has(node.id)) el.classList.add("is-selected");
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
      el.innerHTML = `
        ${node.type !== "start" ? '<button type="button" class="flow-port flow-port-in" data-port="in"></button>' : ""}
        ${node.type !== "end" ? '<button type="button" class="flow-port flow-port-out" data-port="out"></button>' : ""}
        <header class="flow-node-head">
          <span class="flow-node-icon">${ICONS[node.type]}</span>
          <div class="flow-node-copy">
            <span class="flow-node-type" data-i18n-flow="nodes.${node.type}"></span>
            <span class="flow-node-id">${node.id}</span>
          </div>
          <button type="button" class="flow-node-delete" data-i18n-flow-aria="nodes.delete">×</button>
        </header>
        <div class="flow-node-body">${nodeBody(node)}</div>
      `;
      return el;
    }

    function renderNodes() {
      nodesEl.replaceChildren(...nodes.map(renderNode));
      emptyEl.hidden = nodes.length > 0;
      applyI18n();
      drawWires();
    }

    function syncSelectionClass() {
      nodesEl.querySelectorAll(".flow-node").forEach((el) => {
        el.classList.toggle("is-selected", selectedIds.has(el.dataset.nodeId));
      });
    }

    function selectOnly(ids) {
      selectedIds = new Set(ids);
      selectedEdge = null;
      syncSelectionClass();
      drawWires();
    }

    function addNode(type, at) {
      pushHistory();
      fieldEditKey = null;
      const node = {
        id: uid(type, nodes),
        type,
        x: at?.x ?? viewportCenter().x - NODE_WIDTH / 2,
        y: at?.y ?? viewportCenter().y - 48,
      };
      if (type === "start") node.name = "";
      if (type === "command") node.command = "";
      if (type === "end") node.echo = "done";

      const bump = nodes.filter(
        (other) => Math.abs(other.x - node.x) < 16 && Math.abs(other.y - node.y) < 16
      ).length;
      node.x += bump * 28;
      node.y += bump * 28;

      nodes.push(node);
      renderNodes();
      selectOnly([node.id]);
      emitChange();
    }

    function viewportCenter() {
      const rect = viewport.getBoundingClientRect();
      return {
        x: (rect.width / 2 - panX) / zoom,
        y: (rect.height / 2 - panY) / zoom,
      };
    }

    function removeNodes(ids) {
      const idSet = new Set(ids.filter(Boolean));
      if (!idSet.size) return;
      pushHistory();
      fieldEditKey = null;
      nodes = nodes.filter((node) => !idSet.has(node.id));
      edges = edges.filter((edge) => !idSet.has(edge.from) && !idSet.has(edge.to));
      for (const id of idSet) selectedIds.delete(id);
      renderNodes();
      emitChange();
    }

    function removeNode(id) {
      removeNodes([id]);
    }

    function removeEdge(from, to) {
      if (!edges.some((edge) => edge.from === from && edge.to === to)) return;
      pushHistory();
      fieldEditKey = null;
      edges = edges.filter((edge) => !(edge.from === from && edge.to === to));
      selectedEdge = null;
      drawWires();
      emitChange();
    }

    function canConnect(fromId, toId) {
      if (!fromId || !toId || fromId === toId) return false;
      const from = nodes.find((node) => node.id === fromId);
      const to = nodes.find((node) => node.id === toId);
      if (!from || !to) return false;
      if (from.type === "end" || to.type === "start") return false;
      return !edges.some((edge) => edge.from === fromId && edge.to === toId);
    }

    function dropTargetFromEvent(event) {
      const over = document.elementFromPoint(event.clientX, event.clientY);
      const port = over?.closest(".flow-port");
      const nodeEl = over?.closest(".flow-node");
      return {
        nodeId: nodeEl?.dataset.nodeId || null,
        side: port?.dataset.port || null,
      };
    }

    function connectionForDrop(originId, originSide, targetId, targetSide) {
      if (!targetId) return null;
      if (originSide === "out") {
        if (targetSide && targetSide !== "in") return null;
        if (!canConnect(originId, targetId)) return null;
        return { from: originId, to: targetId };
      }
      if (targetSide && targetSide !== "out") return null;
      if (!canConnect(targetId, originId)) return null;
      return { from: targetId, to: originId };
    }

    function updateConnectPreview(event) {
      const worldPos = clientToWorld(event.clientX, event.clientY);
      connecting.x = worldPos.x;
      connecting.y = worldPos.y;
      const drop = dropTargetFromEvent(event);
      nodesEl.querySelectorAll(".flow-node").forEach((el) => {
        el.classList.toggle(
          "is-drop",
          Boolean(connectionForDrop(connecting.nodeId, connecting.side, el.dataset.nodeId, drop.nodeId === el.dataset.nodeId ? drop.side : null))
        );
      });
      const wanted = connecting.side === "out" ? "in" : "out";
      nodesEl.querySelectorAll(".flow-port").forEach((port) => {
        const id = port.closest(".flow-node")?.dataset.nodeId;
        port.classList.toggle("is-target", port.dataset.port === wanted && id !== connecting.nodeId);
      });
      drawWires();
    }

    function connect(fromId, toId) {
      if (!canConnect(fromId, toId)) return;
      pushHistory();
      fieldEditKey = null;
      edges.push({ from: fromId, to: toId });
      emitChange();
    }

    function deleteSelection() {
      if (selectedEdge) {
        const [from, to] = selectedEdge.split("::");
        removeEdge(from, to);
        return true;
      }
      if (selectedIds.size) {
        removeNodes([...selectedIds]);
        return true;
      }
      return false;
    }

    function fieldChanged(nodeId, field, value) {
      const node = nodes.find((item) => item.id === nodeId);
      if (!node) return;
      const key = `${nodeId}:${field}`;
      if (fieldEditKey !== key) {
        pushHistory();
        fieldEditKey = key;
      }
      node[field] = value;
      emitChange();
    }

    function zoomAt(clientX, clientY, nextZoom) {
      const clamped = Math.min(1.8, Math.max(0.45, nextZoom));
      const rect = viewport.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const worldX = (x - panX) / zoom;
      const worldY = (y - panY) / zoom;
      zoom = clamped;
      panX = x - worldX * zoom;
      panY = y - worldY * zoom;
      applyTransform();
      drawWires();
    }

    function isAdditiveEvent(event) {
      return event.shiftKey || event.ctrlKey || event.metaKey;
    }

    function startPan(event) {
      event.preventDefault();
      panning = {
        x: event.clientX - panX,
        y: event.clientY - panY,
        pointerId: event.pointerId,
      };
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add("is-panning");
    }

    function updateMarquee(event) {
      if (!marquee) return;
      const view = viewport.getBoundingClientRect();
      const width = Math.abs(event.clientX - marquee.x0);
      const height = Math.abs(event.clientY - marquee.y0);
      if (width > 3 || height > 3) marquee.moved = true;
      marqueeEl.style.left = `${Math.min(marquee.x0, event.clientX) - view.left}px`;
      marqueeEl.style.top = `${Math.min(marquee.y0, event.clientY) - view.top}px`;
      marqueeEl.style.width = `${width}px`;
      marqueeEl.style.height = `${height}px`;
      marqueeEl.classList.toggle("hidden", !marquee.moved);
      if (!marquee.moved) return;

      const box = {
        left: Math.min(marquee.x0, event.clientX),
        right: Math.max(marquee.x0, event.clientX),
        top: Math.min(marquee.y0, event.clientY),
        bottom: Math.max(marquee.y0, event.clientY),
      };
      nodesEl.querySelectorAll(".flow-node").forEach((el) => {
        const r = el.getBoundingClientRect();
        const hit = !(r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom);
        el.classList.toggle("is-selected", marquee.additive ? selectedIds.has(el.dataset.nodeId) || hit : hit);
      });
    }

    function finishMarquee(event) {
      if (!marquee) return;
      updateMarquee(event);
      viewport.classList.remove("is-selecting");
      marqueeEl.classList.add("hidden");
      if (!marquee.moved) {
        if (!marquee.additive) {
          selectedIds = new Set();
          selectedEdge = null;
        }
      } else {
        const box = {
          left: Math.min(marquee.x0, event.clientX),
          right: Math.max(marquee.x0, event.clientX),
          top: Math.min(marquee.y0, event.clientY),
          bottom: Math.max(marquee.y0, event.clientY),
        };
        const hits = [];
        nodesEl.querySelectorAll(".flow-node").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (!(r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom)) {
            hits.push(el.dataset.nodeId);
          }
        });
        if (marquee.additive) hits.forEach((id) => selectedIds.add(id));
        else selectedIds = new Set(hits);
        selectedEdge = null;
      }
      marquee = null;
      syncSelectionClass();
      drawWires();
    }

    function applyGroupDrag(event) {
      if (!dragging || event.pointerId !== dragging.pointerId) return;
      const worldPos = clientToWorld(event.clientX, event.clientY);
      const dx = worldPos.x - dragging.startX;
      const dy = worldPos.y - dragging.startY;
      if (dx !== 0 || dy !== 0) dragging.moved = true;
      for (const id of dragging.ids) {
        const node = nodes.find((item) => item.id === id);
        const origin = dragging.origins[id];
        if (!node || !origin) continue;
        node.x = origin.x + dx;
        node.y = origin.y + dy;
        const el = nodesEl.querySelector(`[data-node-id="${id}"]`);
        if (el) {
          el.style.left = `${node.x}px`;
          el.style.top = `${node.y}px`;
        }
      }
      drawWires();
    }

    root.querySelectorAll("[data-add]").forEach((btn) => {
      btn.addEventListener("click", () => addNode(btn.dataset.add));
    });

    nodesEl.addEventListener("pointerdown", (event) => {
      if (event.button === 2) return;
      if (event.button !== 0) return;

      const port = event.target.closest(".flow-port");
      const del = event.target.closest(".flow-node-delete");
      const nodeEl = event.target.closest(".flow-node");
      if (!nodeEl) return;

      const id = nodeEl.dataset.nodeId;
      if (!event.target.closest("input")) viewport.focus();

      if (del) {
        event.preventDefault();
        removeNode(id);
        return;
      }

      if (port?.dataset.port) {
        event.preventDefault();
        event.stopPropagation();
        const worldPos = clientToWorld(event.clientX, event.clientY);
        connecting = { nodeId: id, side: port.dataset.port, x: worldPos.x, y: worldPos.y };
        root.classList.add("is-connecting", `is-connecting-from-${port.dataset.port}`);
        viewport.setPointerCapture(event.pointerId);
        drawWires();
        return;
      }

      if (event.target.closest("input")) {
        if (!selectedIds.has(id)) selectOnly([id]);
        return;
      }

      event.preventDefault();
      selectedEdge = null;
      if (isAdditiveEvent(event)) {
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        syncSelectionClass();
        drawWires();
        if (!selectedIds.has(id)) return;
      } else if (!selectedIds.has(id)) {
        selectedIds = new Set([id]);
        syncSelectionClass();
        drawWires();
      }

      const worldPos = clientToWorld(event.clientX, event.clientY);
      const origins = {};
      for (const nid of selectedIds) {
        const node = nodes.find((item) => item.id === nid);
        if (node) origins[nid] = { x: node.x, y: node.y };
      }
      dragging = {
        ids: [...selectedIds],
        origins,
        startX: worldPos.x,
        startY: worldPos.y,
        moved: false,
        pointerId: event.pointerId,
        before: snapshot(),
      };
      root.classList.add("is-dragging-nodes");
      nodeEl.setPointerCapture(event.pointerId);
    });

    nodesEl.addEventListener("pointermove", (event) => {
      if (connecting) {
        updateConnectPreview(event);
        return;
      }
      applyGroupDrag(event);
    });

    function clearConnectPreview() {
      root.classList.remove("is-connecting", "is-connecting-from-in", "is-connecting-from-out");
      nodesEl.querySelectorAll(".flow-node").forEach((el) => el.classList.remove("is-drop"));
      nodesEl.querySelectorAll(".flow-port").forEach((el) => el.classList.remove("is-target"));
    }

    function endConnect(event) {
      if (!connecting) return;
      const drop = dropTargetFromEvent(event);
      const link = connectionForDrop(connecting.nodeId, connecting.side, drop.nodeId, drop.side);
      connecting = null;
      clearConnectPreview();
      if (link) connect(link.from, link.to);
      drawWires();
    }

    nodesEl.addEventListener("pointerup", (event) => {
      if (connecting) {
        endConnect(event);
        return;
      }
      if (dragging && event.pointerId === dragging.pointerId) {
        if (dragging.moved) {
          pushHistory(dragging.before);
          fieldEditKey = null;
          emitChange();
        }
        dragging = null;
        root.classList.remove("is-dragging-nodes");
      }
    });

    nodesEl.addEventListener("pointercancel", () => {
      connecting = null;
      dragging = null;
      marquee = null;
      root.classList.remove("is-dragging-nodes");
      clearConnectPreview();
      drawWires();
    });

    nodesEl.addEventListener("input", (event) => {
      const input = event.target.closest("input[data-field]");
      const nodeEl = event.target.closest(".flow-node");
      if (!input || !nodeEl) return;
      fieldChanged(nodeEl.dataset.nodeId, input.dataset.field, input.value);
    });

    wiresEl.addEventListener("pointerdown", (event) => {
      if (event.button === 2) return;
      if (event.button !== 0) return;
      const wire = event.target.closest(".flow-wire");
      if (!wire || wire.classList.contains("is-temp")) return;
      event.preventDefault();
      event.stopPropagation();
      viewport.focus();
      if (event.target.closest(".flow-wire-delete")) {
        removeEdge(wire.dataset.from, wire.dataset.to);
        return;
      }
      selectedIds = new Set();
      selectedEdge = `${wire.dataset.from}::${wire.dataset.to}`;
      syncSelectionClass();
      drawWires();
    });

    wiresEl.addEventListener("dblclick", (event) => {
      const wire = event.target.closest(".flow-wire");
      if (!wire || wire.classList.contains("is-temp")) return;
      event.preventDefault();
      event.stopPropagation();
      removeEdge(wire.dataset.from, wire.dataset.to);
    });

    viewport.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });

    viewport.addEventListener("pointerdown", (event) => {
      if (event.button === 2) {
        startPan(event);
        return;
      }
      if (event.button !== 0) return;
      if (event.target.closest(".flow-node") || event.target.closest(".flow-wire")) return;

      event.preventDefault();
      viewport.focus();
      marquee = {
        x0: event.clientX,
        y0: event.clientY,
        additive: isAdditiveEvent(event),
        pointerId: event.pointerId,
        moved: false,
      };
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add("is-selecting");
      updateMarquee(event);
    });

    viewport.addEventListener("pointermove", (event) => {
      if (connecting) {
        updateConnectPreview(event);
        return;
      }
      if (marquee && event.pointerId === marquee.pointerId) {
        updateMarquee(event);
        return;
      }
      applyGroupDrag(event);
      if (!panning || event.pointerId !== panning.pointerId) return;
      panX = event.clientX - panning.x;
      panY = event.clientY - panning.y;
      applyTransform();
    });

    viewport.addEventListener("pointerup", (event) => {
      if (connecting) endConnect(event);
      if (marquee) finishMarquee(event);
      if (dragging && event.pointerId === dragging.pointerId) {
        if (dragging.moved) {
          pushHistory(dragging.before);
          fieldEditKey = null;
          emitChange();
        }
        dragging = null;
        root.classList.remove("is-dragging-nodes");
      }
      panning = null;
      viewport.classList.remove("is-panning");
    });

    viewport.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
        zoomAt(event.clientX, event.clientY, zoom * factor);
      },
      { passive: false }
    );

    viewport.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        selectedIds = new Set();
        selectedEdge = null;
        connecting = null;
        marquee = null;
        marqueeEl.classList.add("hidden");
        viewport.classList.remove("is-selecting");
        nodesEl.querySelectorAll(".flow-node").forEach((el) => {
          el.classList.remove("is-selected", "is-drop");
        });
        nodesEl.querySelectorAll(".flow-port").forEach((el) => el.classList.remove("is-target"));
        clearConnectPreview();
        drawWires();
      }
    });

    applyTransform();
    applyI18n();

    return {
      setGraph(graph, { resetHistory = true } = {}) {
        const next = cloneGraph(graph);
        nodes = next.nodes;
        edges = next.edges;
        selectedIds = new Set();
        selectedEdge = null;
        connecting = null;
        dragging = null;
        fieldEditKey = null;
        if (resetHistory) {
          past = [];
          future = [];
        }
        renderNodes();
      },
      getGraph() {
        return cloneGraph({ nodes, edges });
      },
      refresh() {
        renderNodes();
      },
      undo,
      redo,
      deleteSelection,
    };
  }

  function escapeAttr(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  global.FlowCanvas = { create };
})(window);
