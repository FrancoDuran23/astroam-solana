// OperationalBalanceProvider: Abstraction for querying confirmed operational balances
// (e.g., ARQ deposit address / card balance or Citrus reseller balance).
//
// ARQ does not currently provide a public balance API, and Citrus API does not
// provide a global reseller balance endpoint. Therefore, manual or mock balance
// providers are used to feed confirmed balance data safely without guessing.

export interface OperationalBalanceProvider {
  /**
   * Returns the confirmed operational balance in 6-decimal atomic units (micro-USDC),
   * or `null` if the balance is unknown / unconfigured.
   */
  getBalanceAtomic(): Promise<bigint | null>;
}

/**
 * Manual ARQ Balance Provider: holds a manually updated or persistent balance value.
 */
export class ManualArqBalanceProvider implements OperationalBalanceProvider {
  private balanceAtomic: bigint | null = null;

  constructor(initialBalanceAtomic?: bigint | null) {
    this.balanceAtomic = initialBalanceAtomic ?? null;
  }

  setBalanceAtomic(balanceAtomic: bigint | null): void {
    this.balanceAtomic = balanceAtomic;
  }

  async getBalanceAtomic(): Promise<bigint | null> {
    return this.balanceAtomic;
  }
}

/**
 * Mock ARQ Balance Provider for testing.
 */
export class MockArqBalanceProvider implements OperationalBalanceProvider {
  public balanceAtomic: bigint | null;

  constructor(initialBalanceAtomic: bigint | null = 0n) {
    this.balanceAtomic = initialBalanceAtomic;
  }

  async getBalanceAtomic(): Promise<bigint | null> {
    return this.balanceAtomic;
  }
}

/**
 * Manual Citrus Reseller Balance Provider.
 */
export class ManualCitrusBalanceProvider implements OperationalBalanceProvider {
  private balanceAtomic: bigint | null = null;

  constructor(initialBalanceAtomic?: bigint | null) {
    this.balanceAtomic = initialBalanceAtomic ?? null;
  }

  setBalanceAtomic(balanceAtomic: bigint | null): void {
    this.balanceAtomic = balanceAtomic;
  }

  async getBalanceAtomic(): Promise<bigint | null> {
    return this.balanceAtomic;
  }
}

/**
 * Mock Citrus Balance Provider for testing.
 */
export class MockCitrusBalanceProvider implements OperationalBalanceProvider {
  public balanceAtomic: bigint | null;

  constructor(initialBalanceAtomic: bigint | null = 0n) {
    this.balanceAtomic = initialBalanceAtomic;
  }

  async getBalanceAtomic(): Promise<bigint | null> {
    return this.balanceAtomic;
  }
}
