// @ts-nocheck
import { zoomIdentity } from 'd3-zoom';
import { GetState } from 'zustand';

import { clampPosition, isNumeric } from '../utils';
import { getD3Transition, getRectOfNodes, getTransformForBounds } from '../utils/graph';
import {
  CoordinateExtent,
  Edge,
  EdgeSelectionChange,
  Node,
  NodeInternals,
  NodePositionChange,
  NodeSelectionChange,
  ReactFlowState,
  XYPosition,
  XYZPosition,
  FitViewOptions,
  SnapGrid,
} from '../types';

type ParentNodes = Record<string, boolean>;

function calculateXYZPosition(
  node: Node,
  nodeInternals: NodeInternals,
  parentNodes: ParentNodes,
  result: XYZPosition
): XYZPosition {
  if (!node.parentNode) {
    return result;
  }
  const parentNode = nodeInternals.get(node.parentNode)!;

  return calculateXYZPosition(parentNode, nodeInternals, parentNodes, {
    x: (result.x ?? 0) + (parentNode.position?.x ?? 0),
    y: (result.y ?? 0) + (parentNode.position?.y ?? 0),
    z: (parentNode.z ?? 0) > (result.z ?? 0) ? parentNode.z ?? 0 : result.z ?? 0,
  });
}

export function createNodeInternals(nodes: Node[], nodeInternals: NodeInternals): NodeInternals {
  const nextNodeInternals = new Map<string, Node>();
  const parentNodes: ParentNodes = {};

  nodes.forEach((node) => {
    const z = isNumeric(node.zIndex) ? node.zIndex : node.selected ? 1000 : 0;
    const currInternals = nodeInternals.get(node.id);

    const internals: Node = {
      width: currInternals?.width,
      height: currInternals?.height,
      handleBounds: currInternals?.handleBounds,
      ...node,
      positionAbsolute: {
        x: node.position.x,
        y: node.position.y,
      },
      z,
    };
    if (node.parentNode) {
      internals.parentNode = node.parentNode;
      parentNodes[node.parentNode] = true;
    }
    nextNodeInternals.set(node.id, internals);
  });

  nextNodeInternals.forEach((node) => {
    if (node.parentNode && !nextNodeInternals.has(node.parentNode)) {
      throw new Error(`Parent node ${node.parentNode} not found`);
    }

    if (node.parentNode || parentNodes[node.id]) {
      const { x, y, z } = calculateXYZPosition(node, nextNodeInternals, parentNodes, {
        ...node.position,
        z: node.z ?? 0,
      });

      node.positionAbsolute = {
        x,
        y,
      };

      node.z = z;

      if (parentNodes[node.id]) {
        node.isParent = true;
      }
    }
  });

  return nextNodeInternals;
}

type CreatePostionChangeParams = {
  node: Node;
  nodeExtent: CoordinateExtent;
  nodeInternals: NodeInternals;
  diff?: XYPosition;
  snapToGrid?: boolean;
  snapGrid?: SnapGrid;
};

type InternalFitViewOptions = {
  initial?: boolean;
} & FitViewOptions;

export function fitView(get: GetState<ReactFlowState>, options: InternalFitViewOptions = {}) {
  let { nodeInternals, width, height, minZoom, maxZoom, d3Zoom, d3Selection, fitViewOnInitDone, fitViewOnInit } = get();

  if ((options.initial && !fitViewOnInitDone && fitViewOnInit) || !options.initial) {
    if (d3Zoom && d3Selection) {
      const nodes = Array.from(nodeInternals.values()).filter((n) =>
        options.includeHiddenNodes ? !n.parentNode && n.width && n.height : !n.parentNode && !n.hidden
      );

      const nodesInitialized = nodes.every((n) => n.width && n.height);

      if (nodes.length > 0 && nodesInitialized) {
        const bounds = getRectOfNodes(nodes);
        const [x, y, zoom] = getTransformForBounds(
          bounds,
          width,
          height,
          options.minZoom ?? minZoom,
          options.maxZoom ?? maxZoom,
          options.padding ?? 0.1
        );

        const nextTransform = zoomIdentity.translate(x, y).scale(zoom);

        if (typeof options.duration === 'number' && options.duration > 0) {
          d3Zoom.transform(getD3Transition(d3Selection, options.duration), nextTransform);
        } else {
          d3Zoom.transform(d3Selection, nextTransform);
        }

        return true;
      }
    }
  }

  return false;
}

export function handleControlledNodeSelectionChange(nodeChanges: NodeSelectionChange[], nodeInternals: NodeInternals) {
  nodeChanges.forEach((change) => {
    const node = nodeInternals.get(change.id);
    if (node) {
      nodeInternals.set(node.id, {
        ...node,
        selected: change.selected,
      });
    }
  });

  return new Map(nodeInternals);
}

export function handleControlledEdgeSelectionChange(edgeChanges: EdgeSelectionChange[], edges: Edge[]) {
  return edges.map((e) => {
    const change = edgeChanges.find((change) => change.id === e.id);
    if (change) {
      e.selected = change.selected;
    }
    return e;
  });
}
