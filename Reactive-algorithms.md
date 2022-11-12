# Goals

The goal of a reactive library is to run reactive functions when their sources have changed.

We have a few properties that a reactive library should have:

- **Efficient**: Never overexecute reactive elements (if their sources haven't changed, don't rerun)
- **Glitchless**: Never allow user code to see intermediate state where only some reactive elements have updated (by the time you run a reactive element, every source should be updated)

# Lazy/Eager Evaluation

Reactive libraries can be divided into two categories: lazy and eager.

In an eager reactive library, reactive elements are evaluated as soon as one of their sources changes.

In a lazy reactive library, reactive elements are only evaluated when they are needed. (In practice, most lazy libraries also have an eager phase for performance reasons).

We can compare how a lazy vs eager library will evaluate a graph like this:

```mermaid
graph TD
  A((A)) --> B
  A --> C
  B --> D
  C --> D
```

| Lazy                                                                                                                                                                              | Eager                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A lazy library will recognize that the user is asking to update `D`, and will first ask `B` then `C` to update, then update `D` after the `B` and `C` updates have been completed | An eager library will see that `A` has changed, then tell `B` to update, then `C` to update and then `C` will tell `D` to update |

# Reactive Algorithms

The charts below consider how a change being made to `A` updates elements that depend on `A`.

There are two core issues that each algorithm needs to carefully consider. The first is what we call the diamond problem, which can be an issue for eager reactive algorithms. They may accidentally evaluate `A,B,D,C` and then need to evaluate `D` a second time because `C` has updated:

```mermaid
graph TD
  A((A)) --> B
  A --> C
  B --> D
  C --> D
```

The second challenge is the equality check problem, which can be an issue for lazy reactive algorithms. If some node `B` returns the same value as the last time we called it, then the node below it `C` doesn't need to update. (But a naive lazy algorithms might immediately try to update `C` instead of checking if `B` has updated first)

```mermaid
graph TD
  A((A)) --> B
  B --> C
```

To make this more concrete, consider the following code: it is clear that `C` should only ever be run once because every time `A` changes, `B` will reevaluate and return the same value, so none of `C`'s sources have changed.

```ts
const A = reactive(3);
const B = reactive(() => A.value * 0); // always 0
const C = reactive(() => B.value + 1);
```

## MobX

In a blog post a few years ago, [Michael Westrate described](https://hackernoon.com/becoming-fully-reactive-an-in-depth-explanation-of-mobservable-55995262a254) the core algorithm behind MobX. MobX is an eager reactive library, so let's look at how the MobX algorithm solves the diamond problem.

After a change to node `A`, we need to update nodes `B`, `C` and `D` to reflect that change.
It's important that we update `D` only once, and only after `B` and `C` have updated.

MobX uses a two pass algorithm, with both passes proceeding from `A` down through its observers. MobX stores a count of the number of parents that need to be updated with each reactive element.

In the diamond example below, the first pass proceeds as follows:
After an update to `A`, MobX marks a count in `B` and `C` that they now have one parent that needs to update,
and MobX continues down from `B` and from `C` incrementing the count of `D` once for each parent that has a non 0 update count. So when the pass ends `D` has a count of 2 parents above it that need to be updated.

```mermaid
graph TD
  A(("A (0)")) --> B
  A --> C
  B["B (1)"] --> D["D (2)"]
  C["C (1)"] --> D

```

In a second pass, we update every node that has a zero count, and subtract one from each of its children, then tell them to reevaluate if they have a zero count and repeat.

```mermaid
graph TD
  A((A)) --> B
  A --> C
  B["B (0)"] --> D["D (2)"]
  C["C (0)"] --> D
```

Then, `B` and `C` are updated, and `D` notices that both of its parents have updated.

```mermaid
graph TD
  A((A)) --> B
  A --> C
  B --> D["D (0)"]
  C --> D
```

Now finally `D` is updated.

```mermaid
graph TD
  A((A)) --> B
  A --> C
  B --> D
  C --> D
```

This quickly solves the diamond problem by separating the execution of the graph into two phases, one to increase a number of updates and another to update and decrease the number of updates left. 

To solve the equality check problem we just store an additional field that tells each node whether any of its parents have changed value when they updated

## Preact Signals

Preact's solution is described [on their blog](https://preactjs.com/blog/signal-boosting).
Preact started with the MobX algorithm, but they switched to a lazy algorithm.

Preact also has two phases, and the first phase "notifies" down from A (we will explain this in a minute), but the second phase recursively looks up the graph from `D`.

They describe an algorithm to check whether the parents of any signal need to be updated before updating that signal. It does this by storing a version number on each node and on each edge of the reactive dependency graph.

On a graph like the following where A has just changed but B and C have not yet seen that update we could have something like this:

```mermaid
graph TD
  A(("A (1)")) -- "(0)" --> B
  A -- "(0)" --> C
  B["B (2)"] -- "(2)" --> D["D (1)"]
  C["C (7)"] -- "(7)" --> D
```

Then when we fetch D and the reactive elements update we might have a graph that looks like this

```mermaid
graph TD
  A(("A (1)")) -- "(1)" --> B
  A -- "(1)" --> C
  B["B (3)"] -- "(3)" --> D["D (2)"]
  C["C (8)"] -- "(8)" --> D
```

Additionally, Preact stores an extra field that stores whether any of its sources have possibly updated since it has last updated. Then, it avoids walking up the entire graph from `D` to check if any node has a different version when nothing has changed.

We can also see how Preact solves the equality check problem:


```mermaid
graph TD
  A(("A (3)")) -- "(3)" --> B
  B["B (1)"] -- "(1)" --> C["C (1)"]
```

When `A` updates, `B` will rerun, but not change its version because it will still return 0, so `C` will not update.


```mermaid
graph TD
  A(("A (4)")) -- "(4)" --> B
  B["B (1)"] -- "(1)" --> C["C (1)"]
```

# Reactively

Like Preact, Reactively uses one down phase and one up phase.
Instead of version numbers, Reactively uses only graph coloring.

Ryan describes how this system that powers both Reactively and now Solid works in his video announcing [Solid 1.5](https://youtu.be/jHDzGYHY2ew?t=5291).

When a node changes, we color it red (dirty) and all of its children green (check).

[huh, I think reactively marks children red, and grandchildren green!
I think you might need another layer in the graph to show how reactively works..]

```mermaid
graph TD
  A((A)) --> B
  A --> C
  B --> D
  C --> E
  E --> F
  D --> F

  classDef red fill:#f99,color:#000
  classDef green fill:#afa,color:#000;
  class B,C, red;
  class D,E,F green;
```

Then, when we ask for the value of D, we can just check if it is uncolored, then we are done.

Similarly, if we ask for the value of D and it is red, we know that it must be updated immediately.

If it is green, we then walk up the graph to find the first red node that we depend on. If we find one, we update it, and mark only its direct children red:

```mermaid
graph TD
  A((A)) --> B
  A --> C
  B --> D
  C --> E
  E --> F
  D --> F


  classDef red fill:#f99,color:#000
  classDef green fill:#afa,color:#000;
  class B,E red;
  class D,F green;
```

Then, we can update E, and mark its children red:

```mermaid
graph TD
  A((A)) --> B
  A --> C
  B --> D
  C --> E
  E --> F
  D --> F

  classDef red fill:#f99,color:#000
  classDef green fill:#afa,color:#000;
  class B,F red;
  class D green;
```

Finally, we update D, which asks for the value of D and so a mini sub-process happens again to check if any of its grandparents are red and if it needs to update:

```mermaid
graph TD
  A((A)) --> B
  A --> C
  B --> D
  C --> E
  E --> F
  D --> F

  classDef red fill:#f99,color:#000
  class D,F red;
```

And finally we get back to a fully evaluated state:

```mermaid
graph TD
  A((A)) --> B
  A --> C
  B --> D
  C --> E
  E --> F
  D --> F
```