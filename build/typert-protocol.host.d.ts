/**
 * Host-analysis view of the published Typert protocol.
 *
 * The 0.2.1-alpha.2 generator recognizes Remote decorators from an ambient
 * protocol module or a protocol project in the same workspace. This standalone
 * workspace consumes the published package, so Host analysis uses this exact
 * declaration while emitted JavaScript keeps the official bare-package import.
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  const LOOKUP_HOST: unique symbol
  const LOOKUP_WIRE: unique symbol
  const CONTEXT_WIRE: unique symbol

  /** Type-level association between a Host object and its wire identity. */
  export interface TypertLookup<Host, Wire> {
    readonly [LOOKUP_HOST]: Host
    readonly [LOOKUP_WIRE]: Wire
  }

  /** Merge-extensible Host object lookup declarations. */
  export interface TypertLookupMap {}

  /** Type-level association between a scoped Context kind and its wire identity. */
  export interface TypertContext<Wire> {
    readonly [CONTEXT_WIRE]: Wire
  }

  /** Merge-extensible scoped Context declarations. */
  export interface TypertContextMap {}

  /** Options for a Service-to-Gateway binding. */
  export interface TypertGatewayBindingOptions {
    readonly namespace?: string
  }

  /** Minimal Host surface of the published Typert Remote Service. */
  export abstract class TypertRemoteService<out T = never> {
    protected readonly ctx: import('@deepseek-ai/cordis').Context
    protected constructor(
      ctx: import('@deepseek-ai/cordis').Context,
      serviceKey: string,
      options?: TypertGatewayBindingOptions,
    )
  }

  type RemoteMethodDecorator = <This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ) => void

  /** Mark one public instance method as a direct Remote invocation. */
  export function Remote<This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ): void

  /** Mark one public instance method under an exported name. */
  export function Remote(option: string): RemoteMethodDecorator
}
