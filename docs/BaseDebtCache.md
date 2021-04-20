## `BaseDebtCache`

### `requireSystemActiveIfNotOwner()`

### `onlyIssuer()`

### `onlyIssuerOrExchanger()`

### `constructor(address _owner, address _resolver)` (public)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `issuer() → contract IIssuer` (internal)

### `exchanger() → contract IExchanger` (internal)

### `exchangeRates() → contract IExchangeRates` (internal)

### `systemStatus() → contract ISystemStatus` (internal)

### `etherCollateral() → contract IEtherCollateral` (internal)

### `etherCollateralpUSD() → contract IEtherCollateralpUSD` (internal)

### `collateralManager() → contract ICollateralManager` (internal)

### `debtSnapshotStaleTime() → uint256` (external)

### `cachedDebt() → uint256` (external)

### `cachedPynthDebt(bytes32 currencyKey) → uint256` (external)

### `cacheTimestamp() → uint256` (external)

### `cacheInvalid() → bool` (external)

### `_cacheStale(uint256 timestamp) → bool` (internal)

### `cacheStale() → bool` (external)

### `_issuedPynthValues(bytes32[] currencyKeys, uint256[] rates) → uint256[]` (internal)

### `_currentPynthDebts(bytes32[] currencyKeys) → uint256[] periIssuedDebts, bool anyRateIsInvalid` (internal)

### `currentPynthDebts(bytes32[] currencyKeys) → uint256[] debtValues, bool anyRateIsInvalid` (external)

### `_cachedPynthDebts(bytes32[] currencyKeys) → uint256[]` (internal)

### `cachedPynthDebts(bytes32[] currencyKeys) → uint256[] periIssuedDebts` (external)

### `_currentDebt() → uint256 debt, bool anyRateIsInvalid` (internal)

### `currentDebt() → uint256 debt, bool anyRateIsInvalid` (external)

### `cacheInfo() → uint256 debt, uint256 timestamp, bool isInvalid, bool isStale` (external)

### `updateCachedPynthDebts(bytes32[] currencyKeys)` (external)

### `updateCachedPynthDebtWithRate(bytes32 currencyKey, uint256 currencyRate)` (external)

### `updateCachedPynthDebtsWithRates(bytes32[] currencyKeys, uint256[] currencyRates)` (external)

### `updateDebtCacheValidity(bool currentlyInvalid)` (external)

### `purgeCachedPynthDebt(bytes32 currencyKey)` (external)

### `takeDebtSnapshot()` (external)

### `_requireSystemActiveIfNotOwner()` (internal)

### `_onlyIssuer()` (internal)

### `_onlyIssuerOrExchanger()` (internal)
