## `RealtimeDebtCache`

### `constructor(address _owner, address _resolver)` (public)

### `debtSnapshotStaleTime() → uint256` (external)

### `cachedDebt() → uint256` (external)

### `cachedPynthDebt(bytes32 currencyKey) → uint256` (external)

### `cacheTimestamp() → uint256` (external)

### `cacheStale() → bool` (external)

### `cacheInvalid() → bool` (external)

### `cachedPynthDebts(bytes32[] currencyKeys) → uint256[] debtValues` (external)

### `cacheInfo() → uint256 debt, uint256 timestamp, bool isInvalid, bool isStale` (external)

### `purgeCachedPynthDebt(bytes32 currencyKey)` (external)

### `takeDebtSnapshot()` (external)

### `updateCachedPynthDebts(bytes32[] currencyKeys)` (external)

### `updateCachedPynthDebtWithRate(bytes32 currencyKey, uint256 currencyRate)` (external)

### `updateCachedPynthDebtsWithRates(bytes32[] currencyKeys, uint256[] currencyRates)` (external)

### `updateDebtCacheValidity(bool currentlyInvalid)` (external)
