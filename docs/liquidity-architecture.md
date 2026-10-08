# ASTROAM Liquidity & Rebalancing Architecture

## Overview & Multi-Tier Hierarchy

The ASTROAM financial flow operates across four distinct liquidity tiers to balance capital efficiency, security, and low-latency operational availability:

```
+-------------------------------------------------------------+
| 1. Solana Treasury (Primary Treasury - USDC Main Reserve)   |
+-------------------------------------------------------------+
                              |
                              | Circle CCTP v2 + Wormhole Executor
                              v
+-------------------------------------------------------------+
| 2. Polygon Treasury EOA (Transit / Settlement Bridge Node)  |
+-------------------------------------------------------------+
                              |
                              | Native ERC-20 USDC Transfer
                              v
+-------------------------------------------------------------+
| 3. ARQ Balance (Operational Liquidity Buffer)               |
+-------------------------------------------------------------+
                              |
                              | ARQ Global Card Top-up
                              v
+-------------------------------------------------------------+
| 4. Citrus Reseller Balance (Provider Working Balance)       |
+-------------------------------------------------------------+
```

### Roles & Responsibilities

1. **Solana Treasury (Primary Treasury)**:
   - Holds the primary USDC reserves collected from escrow claims.
   - Solana is **never emptied**: protected by `TREASURY_KEEP_USDC`.

2. **Polygon Treasury EOA (Transit Node)**:
   - Acts as the non-custodial, deterministic transit node receiving CCTP burns on Polygon.
   - Forwards funds immediately to the ARQ deposit address.

3. **ARQ Balance (Operational Liquidity Buffer)**:
   - Holds temporary operational buffer liquidity.
   - Managed via `OperationalBalanceProvider` (manual or mock until official ARQ API is available).

4. **Citrus Reseller Balance (Provider Working Balance)**:
   - Holds active working balance for eSIM provisioning and top-ups.
   - An auto-refill failure (`balance.auto_refill_failed`) pauses new eSIMs and tranche top-ups via `ResellerFundingGate`, but **never halts** claims, closes, treasury accounting, or transfers already in-transit.

---

## Rebalancing Decision Rules (`decideRebalance`)

Rebalancing decisions are made using pure bigint arithmetic:

- **Effective Operational Liquidity**:
  $$\text{effectiveOperational} = \text{confirmedBalance} + \text{inTransitLiquidity}$$

- **Buffer Sufficiency**:
  If $\text{effectiveOperational} \ge \text{targetOperational}$, no transfer occurs (`buffer_sufficient`).

- **Reserve Protection**:
  $$\text{availableSolana} = \max(0, \text{treasuryBalance} - \text{keepTreasury})$$
  If $\text{availableSolana} = 0$, no transfer occurs (`treasury_reserve_protected`).

- **Transfer Calculation**:
  $$\text{amountToBridge} = \min(\text{deficit}, \text{availableSolana})$$

- **Minimum Transfer & Max Guard**:
  - If $\text{amountToBridge} < \text{minTransfer}$, no transfer occurs (`below_minimum_transfer`).
  - If $\text{amountToBridge} > \text{maxTransferCap}$, execution fails safely (`exceeds_max_transfer_guard`).
