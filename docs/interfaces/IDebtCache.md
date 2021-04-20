## `IDebtCache`

### `cachedDebt() → uint256` (external)

### `cachedPynthDebt(bytes32 currencyKey) → uint256` (external)

### `cacheTimestamp() → uint256` (external)

### `cacheInvalid() → bool` (external)

### `cacheStale() → bool` (external)

### `currentPynthDebts(bytes32[] currencyKeys) → uint256[] debtValues, bool anyRateIsInvalid` (external)

### `cachedPynthDebts(bytes32[] currencyKeys) → uint256[] debtValues` (external)

### `currentDebt() → uint256 debt, bool anyRateIsInvalid` (external)

### `cacheInfo() → uint256 debt, uint256 timestamp, bool isInvalid, bool isStale` (external)

### `updateCachedPynthDebts(bytes32[] currencyKeys)` (external)

### `updateCachedPynthDebtWithRate(bytes32 currencyKey, uint256 currencyRate)` (external)

### `updateCachedPynthDebtsWithRates(bytes32[] currencyKeys, uint256[] currencyRates)` (external)

### `updateDebtCacheValidity(bool currentlyInvalid)` (external)

### `purgeCachedPynthDebt(bytes32 currencyKey)` (external)

### `takeDebtSnapshot()` (external)
