## `IExchangeRates`

### `aggregators(bytes32 currencyKey) → address` (external)

### `aggregatorWarningFlags() → address` (external)

### `anyRateIsInvalid(bytes32[] currencyKeys) → bool` (external)

### `canFreezeRate(bytes32 currencyKey) → bool` (external)

### `currentRoundForRate(bytes32 currencyKey) → uint256` (external)

### `currenciesUsingAggregator(address aggregator) → bytes32[]` (external)

### `effectiveValue(bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey) → uint256 value` (external)

### `effectiveValueAndRates(bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey) → uint256 value, uint256 sourceRate, uint256 destinationRate` (external)

### `effectiveValueAtRound(bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey, uint256 roundIdForSrc, uint256 roundIdForDest) → uint256 value` (external)

### `getCurrentRoundId(bytes32 currencyKey) → uint256` (external)

### `getLastRoundIdBeforeElapsedSecs(bytes32 currencyKey, uint256 startingRoundId, uint256 startingTimestamp, uint256 timediff) → uint256` (external)

### `inversePricing(bytes32 currencyKey) → uint256 entryPoint, uint256 upperLimit, uint256 lowerLimit, bool frozenAtUpperLimit, bool frozenAtLowerLimit` (external)

### `lastRateUpdateTimes(bytes32 currencyKey) → uint256` (external)

### `oracle() → address` (external)

### `rateAndTimestampAtRound(bytes32 currencyKey, uint256 roundId) → uint256 rate, uint256 time` (external)

### `rateAndUpdatedTime(bytes32 currencyKey) → uint256 rate, uint256 time` (external)

### `rateAndInvalid(bytes32 currencyKey) → uint256 rate, bool isInvalid` (external)

### `rateForCurrency(bytes32 currencyKey) → uint256` (external)

### `rateIsFlagged(bytes32 currencyKey) → bool` (external)

### `rateIsFrozen(bytes32 currencyKey) → bool` (external)

### `rateIsInvalid(bytes32 currencyKey) → bool` (external)

### `rateIsStale(bytes32 currencyKey) → bool` (external)

### `rateStalePeriod() → uint256` (external)

### `ratesAndUpdatedTimeForCurrencyLastNRounds(bytes32 currencyKey, uint256 numRounds) → uint256[] rates, uint256[] times` (external)

### `ratesAndInvalidForCurrencies(bytes32[] currencyKeys) → uint256[] rates, bool anyRateInvalid` (external)

### `ratesForCurrencies(bytes32[] currencyKeys) → uint256[]` (external)

### `freezeRate(bytes32 currencyKey)` (external)
