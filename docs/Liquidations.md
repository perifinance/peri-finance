## `Liquidations`

### `onlyIssuer()`

### `rateNotInvalid(bytes32 currencyKey)`

### `constructor(address _owner, address _resolver)` (public)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `periFinance() → contract IPeriFinance` (internal)

### `systemStatus() → contract ISystemStatus` (internal)

### `issuer() → contract IIssuer` (internal)

### `exchangeRates() → contract IExchangeRates` (internal)

### `eternalStorageLiquidations() → contract EternalStorage` (internal)

### `issuanceRatio() → uint256` (external)

### `liquidationDelay() → uint256` (external)

### `liquidationRatio() → uint256` (external)

### `liquidationPenalty() → uint256` (external)

### `liquidationCollateralRatio() → uint256` (external)

### `getLiquidationDeadlineForAccount(address account) → uint256` (external)

### `isOpenForLiquidation(address account) → bool` (external)

### `isLiquidationDeadlinePassed(address account) → bool` (external)

### `_deadlinePassed(uint256 deadline) → bool` (internal)

### `calculateAmountToFixCollateral(uint256 debtBalance, uint256 collateral) → uint256` (external)

r = target issuance ratio
D = debt balance
V = Collateral
P = liquidation penalty
Calculates amount of pynths = (D - V _ r) / (1 - (1 + P) _ r)

### `_getLiquidationEntryForAccount(address account) → struct Liquidations.LiquidationEntry _liquidation` (internal)

### `_getKey(bytes32 _scope, address _account) → bytes32` (internal)

### `flagAccountForLiquidation(address account)` (external)

### `removeAccountInLiquidation(address account)` (external)

### `checkAndRemoveAccountInLiquidation(address account)` (external)

### `_storeLiquidationEntry(address _account, uint256 _deadline, address _caller)` (internal)

### `_removeLiquidationEntry(address _account)` (internal)

### `AccountFlaggedForLiquidation(address account, uint256 deadline)`

### `AccountRemovedFromLiquidation(address account, uint256 time)`
