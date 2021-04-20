## `PeriFinanceState`

### `constructor(address _owner, address _associatedContract)` (public)

### `setCurrentIssuanceData(address account, uint256 initialDebtOwnership)` (external)

Set issuance data for an address

Only the associated contract may call this.

### `clearIssuanceData(address account)` (external)

Clear issuance data for an address

Only the associated contract may call this.

### `incrementTotalIssuerCount()` (external)

Increment the total issuer count

Only the associated contract may call this.

### `decrementTotalIssuerCount()` (external)

Decrement the total issuer count

Only the associated contract may call this.

### `appendDebtLedgerValue(uint256 value)` (external)

Append a value to the debt ledger

Only the associated contract may call this.

### `debtLedgerLength() → uint256` (external)

Retrieve the length of the debt ledger array

### `lastDebtLedgerEntry() → uint256` (external)

Retrieve the most recent entry from the debt ledger

### `hasIssued(address account) → bool` (external)

Query whether an account has issued and has an outstanding debt balance
