import { TestWithFramework } from "./AllPerfTests";
import { pseudoRandom } from "./PseudoRandom";
import { Computed, ReactiveFramework, Signal } from "./ReactiveFramework";

export interface Graph {
  sources: Signal<number>[];
  layers: Computed<number>[][];
}

export interface GraphAndCounter {
  graph: Graph;
  counter: Counter;
}

/**
 * Make a rectangular dependency graph, with an equal number of source elements
 * and computation elements at every layer.
 *
 * @param width number of source elements and number of computed elements per layer
 * @param totalLayers total number of source and computed layers
 * @param staticFraction every nth computed node is static (1 = all static, 3 = 2/3rd are dynamic)
 * @returns the graph
 */
export function makeGraph(
  testWithFramework: TestWithFramework
): GraphAndCounter {
  const { perfFramework, config } = testWithFramework;
  const { framework } = perfFramework;
  const { width, totalLayers, staticFraction, nSources } = config;

  return framework.withBuild(() => {
    const sources = new Array(width).fill(0).map((_, i) => framework.signal(i));
    const counter = new Counter();
    const rows = makeDependentRows(
      sources,
      totalLayers - 1,
      counter,
      staticFraction,
      nSources,
      framework
    );
    const graph = { sources, layers: rows };
    // logGraph(graph);
    return { graph, counter };
  });
}

/**
 * Execute the graph by writing one of the sources and reading some or all of the leaves.
 *
 * @return the sum of all leaf values
 */
export function runGraph(
  graph: Graph,
  iterations: number,
  readFraction: number,
  framework: ReactiveFramework
): number {
  const rand = pseudoRandom();
  const { sources, layers } = graph;
  const leaves = layers[layers.length - 1];
  const skipCount = Math.round(leaves.length * (1 - readFraction));
  const readLeaves = removeElems(leaves, skipCount, rand);

  for (let i = 0; i < iterations; i++) {
    // console.log("writing signals");
    framework.withBatch(() => {
      const sourceDex = i % sources.length;
      sources[sourceDex].write(i + sourceDex);
    });
    // console.log("reading nth leaves");
    for (const leaf of readLeaves) {
      // console.log("reading leaf", "layer:", leaf.layer.layerNumber);
      leaf.read();
    }
  }

  // console.log("summing all leaves");
  const sum = readLeaves.reduce((total, leaf) => leaf.read() + total, 0);
  return sum;
}

function removeElems<T>(src: T[], rmCount: number, rand: () => number): T[] {
  const copy = src.slice();
  for (let i = 0; i < rmCount; i++) {
    const rmDex = Math.floor(rand() * copy.length);
    copy.splice(rmDex, 1);
  }
  return copy;
}

export function logGraph(graph: Graph): void {
  for (const row of [graph.sources, ...graph.layers]) {
    console.log(
      row
        .map((elem) => {
          const value = elem.read();
          const dynamic = (elem as any)._dynamic ? "*" : "";
          return `${value}${dynamic}`;
        })
        .join(" ")
    );
  }
}

export class Counter {
  count = 0;
}

function makeDependentRows(
  sources: Computed<number>[],
  numRows: number,
  counter: Counter,
  staticFraction: number,
  nSources: number,
  framework: ReactiveFramework
): Computed<number>[][] {
  let prevRow = sources;
  const random = pseudoRandom();
  const rows = [];
  for (let l = 0; l < numRows; l++) {
    const row = makeRow(
      prevRow,
      counter,
      staticFraction,
      nSources,
      framework,
      l,
      random
    );
    rows.push(row);
    prevRow = row;
  }
  return rows;
}

function makeRow(
  sources: Computed<number>[],
  counter: Counter,
  staticFraction: number,
  nSources: number,
  framework: ReactiveFramework,
  layer: number,
  random: () => number
): Computed<number>[] {
  return sources.map((_, myDex) => {
    const mySources: Computed<number>[] = [];
    for (let sourceDex = 0; sourceDex < nSources; sourceDex++) {
      mySources.push(sources[(myDex + sourceDex) % sources.length]);
    }

    const staticNode = random() < staticFraction;
    if (staticNode) {
      // static node, always reference sources
      return framework.computed(() => {
        counter.count++;

        let sum = 0;
        for (const src of mySources) {
          sum += src.read();
        }
        // mySources.forEach((s) => s.read()); // causes stack overflow in large graphs
        return sum;
      });
    } else {
      // dynamic node, drops one of the sources depending on the value of the first element
      const first = mySources[0];
      const tail = mySources.slice(1);
      const node = framework.computed(() => {
        counter.count++;
        let sum = first.read();
        const shouldDrop = sum & 0x1;
        const dropDex = sum % tail.length;

        for (let i = 0; i < tail.length; i++) {
          if (shouldDrop && i === dropDex) continue;
          sum += tail[i].read();
        }

        return sum;
      });
      (node as any)._dynamic = true; // mark dynamic nodes for logging the graph
      return node;
    }
  });
}
