export const BufferSize = 64

export const ChunkTypeId = Symbol.for("@tsplus/collections/Chunk")
export type ChunkTypeId = typeof ChunkTypeId

export const alloc =
  // @ts-ignore
  typeof Buffer !== "undefined" ? Buffer.alloc : (n: number) => new Uint8Array(n)

export function isByte(u: unknown) {
  return typeof u === "number" && Number.isInteger(u) && u >= 0 && u <= 255
}

export type IterableArrayLike<A> = ArrayLike<A> & Iterable<A>

/**
 * A `Chunk<A>` represents a chunk of values of type `A`. Chunks are usually
 * backed by arrays, but expose a purely functional, safe interface
 * to the underlying elements, and they become lazy on operations that would be
 * costly with arrays, such as repeated concatenation.
 *
 * The implementation of balanced concatenation is based on the one for
 * Conc-Trees in "Conc-Trees for Functional and Parallel Programming" by
 * Aleksandar Prokopec and Martin Odersky.
 *
 * http://aleksandar-prokopec.com/resources/docs/lcpc-conc-trees.pdf
 *
 * @tsplus type Chunk
 */
export interface Chunk<A> extends Collection<A> {
  readonly [ChunkTypeId]: ChunkTypeId
  readonly length: number
  [Symbol.iterator](): Iterator<A>
}

export interface ChunkF extends HKT {
  readonly type: Chunk<this["A"]>
}

export declare namespace Chunk {
  export type HKT = ChunkF
}

/**
 * @tsplus type Chunk.Ops
 */
export interface ChunkOps {
  $: ChunkAspects
}
export const Chunk: ChunkOps = {
  $: {}
}

/**
 * @tsplus type Chunk.Aspects
 */
export interface ChunkAspects {}

/**
 * @tsplus unify Chunk
 */
export function unifyChunk<X extends Chunk<any>>(
  self: X
): Chunk<[X] extends [Chunk<infer A>] ? A : never> {
  return self
}

/**
 * Internal base class
 */
export abstract class ChunkInternal<A> implements Chunk<A>, Equals {
  readonly [ChunkTypeId]: ChunkTypeId = ChunkTypeId

  abstract readonly binary: boolean
  abstract readonly length: number
  abstract readonly depth: number
  abstract readonly left: ChunkInternal<A>
  abstract readonly right: ChunkInternal<A>
  abstract _copyToArray(n: number, array: Array<A> | Uint8Array): void
  abstract _get(n: number): A

  protected arrayLikeCache: IterableArrayLike<unknown> | undefined

  _arrayLike(): IterableArrayLike<A> {
    if (this.arrayLikeCache) {
      return this.arrayLikeCache as IterableArrayLike<A>
    }
    const arr = this.binary ? alloc(this.length) : Array.alloc<any>(this.length)

    this._copyToArray(0, arr)
    this.arrayLikeCache = arr
    return arr as IterableArrayLike<A>
  }

  private arrayCache: readonly unknown[] | undefined

  _array(): readonly A[] {
    if (this.arrayCache) {
      return this.arrayCache as readonly A[]
    }
    const arr = Array.alloc<A>(this.length)
    this._copyToArray(0, arr)
    this.arrayCache = arr
    return arr
  }

  [Equals.sym](that: unknown): boolean {
    return isChunk(that) && corresponds_(this, that, Equals.equals)
  }

  [Hash.sym](): number {
    return Hash.iterator(this[Symbol.iterator]())
  }

  toString() {
    return `Chunk(${this._array().join(", ")})`
  }

  toJSON() {
    return this._array()
  }

  abstract [Symbol.iterator](): Iterator<A>
  abstract _arrayLikeIterator(): Iterator<IterableArrayLike<A>>
  abstract _reverseArrayLikeIterator(): Iterator<IterableArrayLike<A>>

  _buckets(): Iterable<IterableArrayLike<A>> {
    return {
      [Symbol.iterator]: () => this._arrayLikeIterator()
    }
  }

  _reverseBuckets(): Iterable<IterableArrayLike<A>> {
    return {
      [Symbol.iterator]: () => this._reverseArrayLikeIterator()
    }
  }

  _reverse(): Iterable<A> {
    const arr = this._arrayLike()
    return {
      [Symbol.iterator]: () => {
        let i = arr.length - 1
        return {
          next: () => {
            if (i >= 0 && i < arr.length) {
              const k = arr[i]!
              i--
              return {
                value: k,
                done: false
              }
            }
            return {
              value: arr.length,
              done: true
            }
          }
        }
      }
    }
  }

  _materialize(): ChunkInternal<A> {
    concreteChunk(this)
    switch (this._typeId) {
      case EmptyTypeId: {
        return this
      }
      case ArrTypeId: {
        return this
      }
      default: {
        return array_(this._arrayLike())
      }
    }
  }

  _append<A1>(a1: A1): ChunkInternal<A | A1> {
    const binary = this.binary && isByte(a1)
    const buffer = this.binary && binary ? alloc(BufferSize) : Array.alloc(BufferSize)
    buffer[0] = a1
    return new AppendN(this, buffer, 1, new AtomicNumber(1), this.binary && binary)
  }

  _prepend<A1>(a1: A1): ChunkInternal<A | A1> {
    const binary = this.binary && isByte(a1)
    const buffer = this.binary && binary ? alloc(BufferSize) : Array.alloc(BufferSize)
    buffer[BufferSize - 1] = a1
    return new PrependN(this, buffer, 1, new AtomicNumber(1), this.binary && binary)
  }

  _take(n: number): ChunkInternal<A> {
    concreteChunk(this)
    if (n <= 0) {
      return _Empty
    } else if (n >= this.length) {
      return this
    } else {
      switch (this._typeId) {
        case EmptyTypeId: {
          return _Empty
        }
        case SliceTypeId: {
          if (n >= this.length) {
            return this
          } else {
            return new Slice(this.chunk, this.offset, n)
          }
        }
        case SingletonTypeId: {
          return this
        }
        default: {
          return new Slice(this, 0, n)
        }
      }
    }
  }

  _concat<A1>(that: ChunkInternal<A1>): ChunkInternal<A | A1> {
    concreteChunk(this)
    concreteChunk(that)

    if (this._typeId === EmptyTypeId) {
      return that
    }
    if (that._typeId === EmptyTypeId) {
      return this
    }
    if (this._typeId === AppendNTypeId) {
      const chunk = array_(this.buffer as A1[])._take(this.bufferUsed)
      return this.start._concat(chunk)._concat(that)
    }
    if (that._typeId === PrependNTypeId) {
      const chunk = array_(
        that.bufferUsed === 0 ? [] : (that.buffer as A1[]).slice(-that.bufferUsed)
      )
      return this._concat(chunk)._concat(that.end)
    }
    const diff = that.depth - this.depth
    if (Math.abs(diff) <= 1) {
      return new Concat<A | A1>(this, that)
    } else if (diff < -1) {
      if (this.left.depth >= this.right.depth) {
        const nr = this.right._concat(that)
        return new Concat(this.left, nr)
      } else {
        const nrr = this.right.right._concat(that)
        if (nrr.depth === this.depth - 3) {
          const nr = new Concat(this.right.left, nrr)
          return new Concat(this.left, nr)
        } else {
          const nl = new Concat(this.left, this.right.left)
          return new Concat(nl, nrr)
        }
      }
    } else {
      if (this.right.depth >= that.left.depth) {
        const nl = this._concat(that.left)
        return new Concat(nl, that.right)
      } else {
        const nll = this._concat(that.left.left)
        if (nll.depth === that.depth - 3) {
          const nl = new Concat(nll, that.left.right)
          return new Concat(nl, that.right)
        } else {
          const nr = new Concat(that.left.right, that.right)
          return new Concat(nll, nr)
        }
      }
    }
  }
}

export const EmptyTypeId = Symbol.for(
  "@effect-ts/core/collection/immutable/Chunk/Empty"
)
export type EmptyTypeId = typeof EmptyTypeId

/**
 * Internal Empty Chunk
 */
export class Empty<A> extends ChunkInternal<A> {
  readonly depth = 0

  readonly _typeId: EmptyTypeId = EmptyTypeId
  readonly left = this
  readonly right = this
  readonly binary = true
  readonly length = 0

  _get(n: number): A {
    throw new IndexOutOfBounds(n, 0, this.length - 1)
  }

  constructor() {
    super()
  }

  _materialize() {
    return array_([])
  }

  _copyToArray(_n: number, _array: Array<A> | Uint8Array) {
    // no-op
  }

  [Symbol.iterator](): Iterator<A> {
    return {
      next: () => ({
        value: 0,
        done: true
      })
    }
  }

  _arrayLikeIterator(): Iterator<IterableArrayLike<A>> {
    return {
      next: () => ({
        value: 0,
        done: true
      })
    }
  }

  _reverseArrayLikeIterator(): Iterator<IterableArrayLike<A>> {
    return {
      next: () => ({
        value: 0,
        done: true
      })
    }
  }
}

export const _Empty: ChunkInternal<never> = new Empty()

/**
 * @tsplus macro remove
 */
export function concreteChunk<A>(
  _: Chunk<A>
): asserts _ is
  | Empty<A>
  | AppendN<A>
  | Arr<A>
  | Slice<A>
  | Singleton<A>
  | PrependN<A>
  | Concat<A>
{
  //
}

/**
 * @tsplus macro identity
 */
export function concreteChunkId<A>(
  _: Chunk<A>
): Empty<A> | AppendN<A> | Arr<A> | Slice<A> | Singleton<A> | PrependN<A> | Concat<A> {
  concreteChunk(_)
  return _
}

export const AppendNTypeId = Symbol.for(
  "@effect-ts/core/collection/immutable/Chunk/AppendN"
)
export type AppendNTypeId = typeof AppendNTypeId

/**
 * Internal Append Chunk
 */
export class AppendN<A> extends ChunkInternal<A> {
  readonly _typeId: AppendNTypeId = AppendNTypeId

  readonly depth = 0
  readonly left = _Empty
  readonly right = _Empty
  readonly length: number

  constructor(
    readonly start: ChunkInternal<A>,
    readonly buffer: Array<unknown> | Uint8Array,
    readonly bufferUsed: number,
    readonly chain: AtomicNumber,
    readonly binary: boolean
  ) {
    super()
    this.length = this.start.length + this.bufferUsed
  }

  _get(n: number): A {
    if (n < this.start.length) {
      return this.start._get(n)
    }
    const k = n - this.start.length
    if (k >= this.buffer.length || k < 0) {
      throw new IndexOutOfBounds(n, 0, this.length - 1)
    }
    return (this.buffer as A[])[k]!
  }

  _append<A1>(a1: A1): ChunkInternal<A | A1> {
    const binary = this.binary && isByte(a1)

    if (
      this.bufferUsed < this.buffer.length &&
      this.chain.compareAndSet(this.bufferUsed, this.bufferUsed + 1)
    ) {
      if (this.binary && !binary) {
        const buffer = Array.alloc(BufferSize)
        for (let i = 0; i < BufferSize; i++) {
          buffer[i] = this.buffer[i]
        }
        buffer[this.bufferUsed] = a1
        return new AppendN(
          this.start,
          buffer,
          this.bufferUsed + 1,
          this.chain,
          this.binary && binary
        )
      }
      this.buffer[this.bufferUsed] = a1
      return new AppendN(
        this.start,
        this.buffer,
        this.bufferUsed + 1,
        this.chain,
        this.binary && binary
      )
    } else {
      const buffer = this.binary && binary ? alloc(BufferSize) : Array.alloc(BufferSize)
      buffer[0] = a1
      const chunk = array_(this.buffer as A1[])._take(this.bufferUsed)
      return new AppendN(
        this.start._concat(chunk),
        buffer,
        1,
        new AtomicNumber(1),
        this.binary && binary
      )
    }
  }

  _copyToArray(n: number, array: Array<A> | Uint8Array) {
    this.start._copyToArray(n, array)
    _copy(this.buffer as A[], 0, array, this.start.length + n, this.bufferUsed)
  }

  [Symbol.iterator](): Iterator<A> {
    const k = this._arrayLike()
    return k[Symbol.iterator]()
  }

  _arrayLikeIterator(): Iterator<IterableArrayLike<A>> {
    const array = this._arrayLike()
    let done = false
    return {
      next: () => {
        if (!done) {
          done = true
          return {
            value: array,
            done: false
          }
        } else {
          return {
            value: 1,
            done: true
          }
        }
      }
    }
  }

  _reverseArrayLikeIterator(): Iterator<IterableArrayLike<A>> {
    const array = this._arrayLike()
    let done = false
    return {
      next: () => {
        if (!done) {
          done = true
          return {
            value: array,
            done: false
          }
        } else {
          return {
            value: 1,
            done: true
          }
        }
      }
    }
  }
}

export const ArrTypeId = Symbol.for("@effect-ts/core/collection/immutable/Chunk/Arr")
export type ArrTypeId = typeof ArrTypeId

/**
 * Internal Array Chunk
 */
export abstract class Arr<A> extends ChunkInternal<A> {
  readonly _typeId: ArrTypeId = ArrTypeId
}

/**
 * Internal Plain Array Chunk
 */
export class PlainArr<A> extends Arr<A> {
  readonly depth = 0
  readonly left = _Empty
  readonly right = _Empty
  readonly length: number
  private isBytes?: boolean

  constructor(readonly array: readonly A[]) {
    super()
    this.length = array.length
  }

  get binary(): boolean {
    if (typeof this.isBytes !== "undefined") {
      return this.isBytes
    }
    this.isBytes = this.array.every(isByte)
    return this.isBytes
  }

  _get(n: number): A {
    if (n >= this.length || n < 0) {
      throw new IndexOutOfBounds(n, 0, this.length - 1)
    }
    return this.array[n]!
  }

  _arrayLike() {
    if (!this.binary) {
      return this.array
    }
    if (this.arrayLikeCache) {
      return this.arrayLikeCache as IterableArrayLike<A>
    }
    const arr = alloc(this.length)
    this._copyToArray(0, arr)
    this.arrayLikeCache = arr
    return arr as unknown as IterableArrayLike<A>
  }

  _array() {
    return this.array
  }

  _materialize() {
    return this
  }

  _copyToArray(n: number, array: Array<A> | Uint8Array) {
    _copy(this.array, 0, array, n, this.length)
  }

  [Symbol.iterator](): Iterator<A> {
    return this.array[Symbol.iterator]()
  }

  _arrayLikeIterator(): Iterator<IterableArrayLike<A>> {
    let done = false
    return {
      next: () => {
        if (!done) {
          done = true
          return {
            value: this.array,
            done: false
          }
        } else {
          return {
            value: 1,
            done: true
          }
        }
      }
    }
  }

  _reverseArrayLikeIterator(): Iterator<IterableArrayLike<A>> {
    let done = false
    return {
      next: () => {
        if (!done) {
          done = true
          return {
            value: this.array,
            done: false
          }
        } else {
          return {
            value: 1,
            done: true
          }
        }
      }
    }
  }
}

/**
 * Internal Binary Array Chunk
 */
export class Uint8Arr extends Arr<number> {
  readonly depth = 0
  readonly left = _Empty
  readonly right = _Empty
  readonly length: number
  readonly binary = true

  constructor(readonly array: Uint8Array) {
    super()
    this.length = array.length
  }

  _arrayLike() {
    return this.array
  }

  _get(n: number): number {
    if (n >= this.length || n < 0) {
      throw new IndexOutOfBounds(n, 0, this.length - 1)
    }
    return this.array[n]!
  }

  _materialize() {
    return this
  }

  _copyToArray(n: number, array: Array<number> | Uint8Array) {
    _copy(this.array, 0, array, n, this.length)
  }

  [Symbol.iterator](): Iterator<number> {
    return this.array[Symbol.iterator]()
  }

  _arrayLikeIterator(): Iterator<IterableArrayLike<number>> {
    let done = false
    return {
      next: () => {
        if (!done) {
          done = true
          return {
            value: this.array,
            done: false
          }
        } else {
          return {
            value: 1,
            done: true
          }
        }
      }
    }
  }

  _reverseArrayLikeIterator(): Iterator<IterableArrayLike<number>> {
    let done = false
    return {
      next: () => {
        if (!done) {
          done = true
          return {
            value: this.array,
            done: false
          }
        } else {
          return {
            value: 1,
            done: true
          }
        }
      }
    }
  }
}

export const SliceTypeId = Symbol.for(
  "@effect-ts/core/collection/immutable/Chunk/Slice"
)
export type SliceTypeId = typeof SliceTypeId

/**
 * Internal Slice Chunk
 */
export class Slice<A> extends ChunkInternal<A> {
  readonly depth = 0
  readonly left = _Empty
  readonly right = _Empty
  readonly binary: boolean
  readonly _typeId: SliceTypeId = SliceTypeId

  _get(n: number): A {
    return this.chunk._get(n + this.offset)
  }

  constructor(
    readonly chunk: ChunkInternal<A>,
    readonly offset: number,
    readonly length: number
  ) {
    super()
    this.binary = this.chunk.binary
  }

  _copyToArray(n: number, array: Array<A> | Uint8Array) {
    let i = 0
    let j = n
    while (i < this.length) {
      array[j] = this._get(i)!
      i += 1
      j += 1
    }
  }

  [Symbol.iterator](): Iterator<A> {
    const k = this._arrayLike()
    return k[Symbol.iterator]()
  }

  _arrayLikeIterator(): Iterator<IterableArrayLike<A>> {
    const array = this._arrayLike()
    let done = false
    return {
      next: () => {
        if (!done) {
          done = true
          return {
            value: array,
            done: false
          }
        } else {
          return {
            value: 1,
            done: true
          }
        }
      }
    }
  }

  _reverseArrayLikeIterator(): Iterator<IterableArrayLike<A>> {
    const array = this._arrayLike()
    let done = false
    return {
      next: () => {
        if (!done) {
          done = true
          return {
            value: array,
            done: false
          }
        } else {
          return {
            value: 1,
            done: true
          }
        }
      }
    }
  }
}

export const SingletonTypeId = Symbol.for(
  "@effect-ts/core/collection/immutable/Chunk/Singleton"
)
export type SingletonTypeId = typeof SingletonTypeId

/**
 * Internal Singleton Chunk
 */
export class Singleton<A> extends ChunkInternal<A> {
  readonly depth = 0
  readonly left = _Empty
  readonly right = _Empty
  readonly length = 1
  readonly _typeId: SingletonTypeId = SingletonTypeId

  _get(n: number): A {
    if (n === 0) {
      return this.a
    }
    throw new IndexOutOfBounds(n, 0, this.length - 1)
  }

  readonly binary: boolean

  constructor(readonly a: A) {
    super()
    this.binary = isByte(a)
  }

  _copyToArray(n: number, array: Array<A> | Uint8Array) {
    array[n] = this.a
  }

  [Symbol.iterator](): Iterator<A> {
    const k = this._arrayLike()
    return k[Symbol.iterator]()
  }

  _arrayLikeIterator(): Iterator<IterableArrayLike<A>> {
    let done = false
    return {
      next: () => {
        if (!done) {
          done = true
          return {
            value: this._arrayLike(),
            done: false
          }
        } else {
          return {
            value: 1,
            done: true
          }
        }
      }
    }
  }

  _reverseArrayLikeIterator(): Iterator<IterableArrayLike<A>> {
    let done = false
    return {
      next: () => {
        if (!done) {
          done = true
          return {
            value: this._arrayLike(),
            done: false
          }
        } else {
          return {
            value: 1,
            done: true
          }
        }
      }
    }
  }
}

export const PrependNTypeId = Symbol.for(
  "@effect-ts/core/collection/immutable/Chunk/PrependN"
)
export type PrependNTypeId = typeof PrependNTypeId

/**
 * Internal Prepend Chunk
 */
export class PrependN<A> extends ChunkInternal<A> {
  readonly depth = 0
  readonly left = _Empty
  readonly right = _Empty
  readonly length: number
  readonly _typeId: PrependNTypeId = PrependNTypeId

  _get(n: number): A {
    if (n < this.bufferUsed) {
      const k = BufferSize - this.bufferUsed + n
      if (k >= this.buffer.length || k < 0) {
        throw new IndexOutOfBounds(n, 0, this.length - 1)
      }
      return (this.buffer as A[])[k]!
    }
    return this.end._get(n - this.bufferUsed)
  }

  constructor(
    readonly end: ChunkInternal<A>,
    readonly buffer: Array<unknown> | Uint8Array,
    readonly bufferUsed: number,
    readonly chain: AtomicNumber,
    readonly binary: boolean
  ) {
    super()
    this.length = this.end.length + this.bufferUsed
  }

  _copyToArray(n: number, array: Array<A> | Uint8Array) {
    const length = Math.min(this.bufferUsed, Math.max(array.length - n, 0))
    _copy(this.buffer, BufferSize - this.bufferUsed, array, n, length)
    this.end._copyToArray(n + length, array)
  }

  prepend<A1>(a1: A1): ChunkInternal<A | A1> {
    const binary = this.binary && isByte(a1)
    if (
      this.bufferUsed < this.buffer.length &&
      this.chain.compareAndSet(this.bufferUsed, this.bufferUsed + 1)
    ) {
      if (this.binary && !binary) {
        const buffer = Array.alloc(BufferSize)
        for (let i = 0; i < BufferSize; i++) {
          buffer[i] = this.buffer[i]
        }
        buffer[BufferSize - this.bufferUsed - 1] = a1
        return new PrependN(this.end, buffer, this.bufferUsed + 1, this.chain, false)
      }
      this.buffer[BufferSize - this.bufferUsed - 1] = a1
      return new PrependN(
        this.end,
        this.buffer,
        this.bufferUsed + 1,
        this.chain,
        this.binary && binary
      )
    } else {
      const buffer = binary ? alloc(BufferSize) : Array.alloc(BufferSize)
      buffer[BufferSize - 1] = a1
      const chunk = array_(
        "subarray" in this.buffer
          ? this.buffer.subarray(this.buffer.length - this.bufferUsed)
          : this.buffer.slice(this.buffer.length - this.bufferUsed)
      ) as ChunkInternal<A>
      return new PrependN(
        chunk._concat(this.end),
        buffer,
        1,
        new AtomicNumber(1),
        this.binary && binary
      )
    }
  }

  [Symbol.iterator](): Iterator<A> {
    const k = this._arrayLike()
    return k[Symbol.iterator]()
  }

  _arrayLikeIterator(): Iterator<IterableArrayLike<A>> {
    let done = false
    return {
      next: () => {
        if (!done) {
          done = true
          return {
            value: this._arrayLike(),
            done: false
          }
        } else {
          return {
            value: 1,
            done: true
          }
        }
      }
    }
  }

  _reverseArrayLikeIterator(): Iterator<IterableArrayLike<A>> {
    let done = false
    return {
      next: () => {
        if (!done) {
          done = true
          return {
            value: this._arrayLike(),
            done: false
          }
        } else {
          return {
            value: 1,
            done: true
          }
        }
      }
    }
  }
}

/**
 * Internal copy arrays
 */
export function _copy<A>(
  src: IterableArrayLike<A>,
  srcPos: number,
  dest: A[] | Uint8Array,
  destPos: number,
  len: number
) {
  for (let i = srcPos; i < Math.min(src.length, srcPos + len); i++) {
    dest[destPos + i - srcPos] = src[i]!
  }
  return dest
}

export const ConcatTypeId = Symbol.for(
  "@effect-ts/core/collection/immutable/Chunk/Concat"
)
export type ConcatTypeId = typeof ConcatTypeId

/**
 * Internal Concat Chunk
 */
export class Concat<A> extends ChunkInternal<A> {
  readonly depth: number
  readonly _typeId: ConcatTypeId = ConcatTypeId
  readonly length: number
  readonly binary: boolean

  _get(n: number): A {
    return n < this.left.length
      ? this.left._get(n)
      : this.right._get(n - this.left.length)
  }

  constructor(readonly left: ChunkInternal<A>, readonly right: ChunkInternal<A>) {
    super()
    this.depth = 1 + Math.max(this.left.depth, this.right.depth)
    this.length = this.left.length + this.right.length
    this.binary = this.left.binary && this.right.binary
  }

  _copyToArray(n: number, array: Array<A> | Uint8Array) {
    this.left._copyToArray(n, array)
    this.right._copyToArray(n + this.left.length, array)
  }

  [Symbol.iterator](): Iterator<A> {
    const k = this._arrayLike()
    return k[Symbol.iterator]()
  }

  _arrayLikeIterator(): Iterator<IterableArrayLike<A>> {
    let it = this.left._arrayLikeIterator()
    let i = 0
    let n = it.next()
    let j = 0
    return {
      next: () => {
        j++
        if (i === 0 && n.done) {
          it = this.right._arrayLikeIterator()
          const k = it.next()
          if (k.done) {
            return {
              value: j,
              done: true
            }
          }
          i++
          n = it.next()
          return k
        } else {
          if (n.done) {
            return {
              value: j,
              done: true
            }
          }
          const k = n
          n = it.next()
          return k
        }
      }
    }
  }

  _reverseArrayLikeIterator(): Iterator<IterableArrayLike<A>> {
    let it = this.right._arrayLikeIterator()
    let i = 0
    let n = it.next()
    let j = 0
    return {
      next: () => {
        j++
        if (i === 0 && n.done) {
          it = this.left._arrayLikeIterator()
          const k = it.next()
          if (k.done) {
            return {
              value: j,
              done: true
            }
          }
          i++
          n = it.next()
          return k
        } else {
          if (n.done) {
            return {
              value: j,
              done: true
            }
          }
          const k = n
          n = it.next()
          return k
        }
      }
    }
  }
}

/**
 * Type guard
 *
 * @tsplus static Chunk.Ops isChunk
 */
export function isChunk<A>(u: Iterable<A>): u is Chunk<A>
export function isChunk(u: unknown): u is Chunk<unknown>
export function isChunk(u: unknown): u is Chunk<unknown> {
  return typeof u === "object" && u != null && ChunkTypeId in u
}

/**
 * Internal Array Chunk Constructor
 */
function array_<A>(array: Iterable<A>): ChunkInternal<A>
function array_(
  array: Uint8Array | Iterable<unknown> | IterableArrayLike<unknown>
): ChunkInternal<unknown> {
  if (isChunk(array)) {
    concreteChunk(array)
    return array
  }
  if (array instanceof Uint8Array) {
    return new Uint8Arr(array)
  }
  return new PlainArr(Array.isArray(array) ? array : Array.from(array))
}

/**
 * Builds a chunk from an array.
 *
 * @tsplus static Chunk.Ops from
 */
export function from<A>(array: Iterable<A>): Chunk<A> {
  return array_(array)
}

/**
 * Determines whether this chunk and the specified chunk have the same length
 * and every pair of corresponding elements of this chunk and the specified
 * chunk satisfy the specified predicate.
 *
 * @tsplus fluent Chunk corresponds
 */
export function corresponds_<A, B>(
  self: Chunk<A>,
  that: Chunk<B>,
  f: (a: A, b: B) => boolean
): boolean {
  if (concreteChunkId(self).length !== concreteChunkId(that).length) {
    return false
  }

  const leftIterator = concreteChunkId(self)._arrayLikeIterator()
  const rightIterator = concreteChunkId(that)._arrayLikeIterator()

  let i = 0
  let j = 0
  let equal = true
  let done = false
  let leftLength = 0
  let rightLength = 0
  let left: IterableArrayLike<A> | undefined = undefined
  let right: IterableArrayLike<B> | undefined = undefined
  let leftNext
  let rightNext

  while (equal && !done) {
    if (i < leftLength && j < rightLength) {
      if (!f(left![i]!, right![j]!)) {
        equal = false
      }
      i++
      j++
    } else if (i === leftLength && (leftNext = leftIterator.next()) && !leftNext.done) {
      left = leftNext.value
      leftLength = left.length
      i = 0
    } else if (
      j === rightLength &&
      (rightNext = rightIterator.next()) &&
      !rightNext.done
    ) {
      right = rightNext.value
      rightLength = right.length
      j = 0
    } else if (i === leftLength && j === rightLength) {
      done = true
    } else {
      equal = false
    }
  }

  return equal
}

/**
 * Determines whether this chunk and the specified chunk have the same length
 * and every pair of corresponding elements of this chunk and the specified
 * chunk satisfy the specified predicate.
 *
 * @tsplus static Chunk.Aspects corresponds
 */
export const corresponds = Pipeable(corresponds_)
