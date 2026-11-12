// Immutable swept intervals live at the first timestamp midpoint they cross.
// Each node sorts both endpoints, so a query on one side visits only matches.
// Fixed dataset bounds keep the tree balanced even for chronological inserts.
export function createLevelIndex(firstTs, lastTs) {
  let root;

  function insertSorted(items, line, key, direction) {
    let lo = 0;
    let hi = items.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (direction * items[mid][key] <= direction * line[key]) lo = mid + 1;
      else hi = mid;
    }
    items.splice(lo, 0, line);
  }

  function insert(node, lo, hi, line) {
    node ??= { center: lo + Math.floor((hi - lo) / 2), starts: [], ends: [] };
    if (line.toTs < node.center) {
      node.left = insert(node.left, lo, node.center - 1, line);
    } else if (line.fromTs > node.center) {
      node.right = insert(node.right, node.center + 1, hi, line);
    } else {
      insertSorted(node.starts, line, 'fromTs', 1);
      insertSorted(node.ends, line, 'toTs', -1);
    }
    return node;
  }

  function query(fromTs, toTs) {
    const matches = [];
    function visit(node) {
      if (!node) return;
      if (toTs < node.center) {
        for (const line of node.starts) {
          if (line.fromTs > toTs) break;
          matches.push(line);
        }
        visit(node.left);
      } else if (fromTs > node.center) {
        for (const line of node.ends) {
          if (line.toTs < fromTs) break;
          matches.push(line);
        }
        visit(node.right);
      } else {
        for (const line of node.starts) matches.push(line);
        visit(node.left);
        visit(node.right);
      }
    }
    visit(root);
    return matches;
  }

  return { add(line) { root = insert(root, firstTs, lastTs, line); }, query };
}
