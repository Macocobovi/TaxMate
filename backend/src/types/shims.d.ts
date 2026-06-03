declare module "bcryptjs" {
  export function hash(value: string, salt: number | string): Promise<string>;
  export function compare(value: string, hash: string): Promise<boolean>;
  const bcrypt: {
    hash: typeof hash;
    compare: typeof compare;
  };
  export default bcrypt;
}

declare module "pg" {
  export class Pool {
    constructor(config?: Record<string, unknown>);
    connect(...args: unknown[]): unknown;
    query(...args: unknown[]): Promise<unknown>;
    end(): Promise<void>;
  }
}
