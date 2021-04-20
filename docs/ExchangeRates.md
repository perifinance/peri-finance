## `ExchangeRates`

### `onlyOracle()`

### `constructor(address _owner, address _oracle, address _resolver, bytes32[] _currencyKeys, uint256[] _newRates)` (public)

### `setOracle(address _oracle)` (external)

### `setOracleKovan(address _oracle)` (external)

### `updateRates(bytes32[] currencyKeys, uint256[] newRates, uint256 timeSent) → bool` (external)

### `deleteRate(bytes32 currencyKey)` (external)

### `setInversePricing(bytes32 currencyKey, uint256 entryPoint, uint256 upperLimit, uint256 lowerLimit, bool freezeAtUpperLimit, bool freezeAtLowerLimit)` (external)

### `removeInversePricing(bytes32 currencyKey)` (external)

### `addAggregator(bytes32 currencyKey, address aggregatorAddress)` (external)

### `removeAggregator(bytes32 currencyKey)` (external)

### `freezeRate(bytes32 currencyKey)` (external)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `canFreezeRate(bytes32 currencyKey) → bool` (external)

### `currenciesUsingAggregator(address aggregator) → bytes32[] currencies` (external)

### `rateStalePeriod() → uint256` (external)

### `aggregatorWarningFlags() → address` (external)

### `rateAndUpdatedTime(bytes32 currencyKey) → uint256 rate, uint256 time` (external)

### `getLastRoundIdBeforeElapsedSecs(bytes32 currencyKey, uint256 startingRoundId, uint256 startingTimestamp, uint256 timediff) → uint256` (external)

### `getCurrentRoundId(bytes32 currencyKey) → uint256` (external)

### `effectiveValueAtRound(bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey, uint256 roundIdForSrc, uint256 roundIdForDest) → uint256 value` (external)

### `rateAndTimestampAtRound(bytes32 currencyKey, uint256 roundId) → uint256 rate, uint256 time` (external)

### `lastRateUpdateTimes(bytes32 currencyKey) → uint256` (external)

### `lastRateUpdateTimesForCurrencies(bytes32[] currencyKeys) → uint256[]` (external)

### `effectiveValue(bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey) → uint256 value` (external)

### `effectiveValueAndRates(bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey) → uint256 value, uint256 sourceRate, uint256 destinationRate` (external)

### `rateForCurrency(bytes32 currencyKey) → uint256` (external)

### `ratesAndUpdatedTimeForCurrencyLastNRounds(bytes32 currencyKey, uint256 numRounds) → uint256[] rates, uint256[] times` (external)

### `ratesForCurrencies(bytes32[] currencyKeys) → uint256[]` (external)

### `rateAndInvalid(bytes32 currencyKey) → uint256 rate, bool isInvalid` (external)

### `ratesAndInvalidForCurrencies(bytes32[] currencyKeys) → uint256[] rates, bool anyRateInvalid` (external)

### `rateIsStale(bytes32 currencyKey) → bool` (external)

### `rateIsFrozen(bytes32 currencyKey) → bool` (external)

### `rateIsInvalid(bytes32 currencyKey) → bool` (external)

### `rateIsFlagged(bytes32 currencyKey) → bool` (external)

### `anyRateIsInvalid(bytes32[] currencyKeys) → bool` (external)

### `exchanger() → contract IExchanger` (internal)

### `getFlagsForRates(bytes32[] currencyKeys) → bool[] flagList` (internal)

### `_setRate(bytes32 currencyKey, uint256 rate, uint256 time)` (internal)

### `internalUpdateRates(bytes32[] currencyKeys, uint256[] newRates, uint256 timeSent) → bool` (internal)

### `removeFromArray(bytes32 entry, bytes32[] array) → bool` (internal)

### `_rateOrInverted(bytes32 currencyKey, uint256 rate, uint256 roundId) → uint256 newRate` (internal)

### `_formatAggregatorAnswer(bytes32 currencyKey, int256 rate) → uint256` (internal)

### `_getRateAndUpdatedTime(bytes32 currencyKey) → struct IExchangeRates.RateAndUpdatedTime` (internal)

### `_getCurrentRoundId(bytes32 currencyKey) → uint256` (internal)

### `_getRateAndTimestampAtRound(bytes32 currencyKey, uint256 roundId) → uint256 rate, uint256 time` (internal)

### `_getRate(bytes32 currencyKey) → uint256` (internal)

### `_getUpdatedTime(bytes32 currencyKey) → uint256` (internal)

### `_effectiveValueAndRates(bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey) → uint256 value, uint256 sourceRate, uint256 destinationRate` (internal)

### `_rateIsStale(bytes32 currencyKey, uint256 _rateStalePeriod) → bool` (internal)

### `_rateIsStaleWithTime(uint256 _rateStalePeriod, uint256 _time) → bool` (internal)

### `_rateIsFrozen(bytes32 currencyKey) → bool` (internal)

### `_rateIsFlagged(bytes32 currencyKey, contract FlagsInterface flags) → bool` (internal)

### `_onlyOracle()` (internal)

### `OracleUpdated(address newOracle)`

### `RatesUpdated(bytes32[] currencyKeys, uint256[] newRates)`

### `RateDeleted(bytes32 currencyKey)`

### `InversePriceConfigured(bytes32 currencyKey, uint256 entryPoint, uint256 upperLimit, uint256 lowerLimit)`

### `InversePriceFrozen(bytes32 currencyKey, uint256 rate, uint256 roundId, address initiator)`

### `AggregatorAdded(bytes32 currencyKey, address aggregator)`

### `AggregatorRemoved(bytes32 currencyKey, address aggregator)`
