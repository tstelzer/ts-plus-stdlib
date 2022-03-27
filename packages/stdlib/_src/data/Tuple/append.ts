import type { Tuple } from "@tsplus/stdlib/data/Tuple/definition";
import { TupleInternal } from "@tsplus/stdlib/data/Tuple/definition";

/**
 * Appends a value to a tuple.
 *
 * @tsplus fluent tsplus/Tuple append
 */
export function append<Ks extends unknown[], K>(
  self: Tuple<Ks>,
  k: K
): Tuple<[...Ks, K]> {
  return new TupleInternal([...self.tuple, k]);
}