## `DebtCache`

### `constructor(address _owner, address _resolver)` (public)

### `purgeCachedPynthDebt(bytes32 currencyKey)` (external)

### `takeDebtSnapshot()` (external)

### `updateCachedpynthDebts(bytes32[] currencyKeys)` (external)

### `updateCachedpynthDebtWithRate(bytes32 currencyKey, uint256 currencyRate)` (external)

### `updateCachedPynthDebtsWithRates(bytes32[] currencyKeys, uint256[] currencyRates)` (external)

### `updateDebtCacheValidity(bool currentlyInvalid)` (external)

### `_updateDebtCacheValidity(bool currentlyInvalid)` (internal)

### `_updateCachedPynthDebtsWithRates(bytes32[] currencyKeys, uint256[] currentRates, bool anyRateIsInvalid)` (internal)

### `DebtCacheUpdated(uint256 cachedDebt)`

### `DebtCacheSnapshotTaken(uint256 timestamp)`

### `DebtCacheValidityChanged(bool isInvalid)`
