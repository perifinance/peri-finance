## `SystemSettings`

### `constructor(address _owner, address _resolver)` (public)

### `waitingPeriodSecs() → uint256` (external)

### `priceDeviationThresholdFactor() → uint256` (external)

### `issuanceRatio() → uint256` (external)

### `feePeriodDuration() → uint256` (external)

### `targetThreshold() → uint256` (external)

### `liquidationDelay() → uint256` (external)

### `liquidationRatio() → uint256` (external)

### `liquidationPenalty() → uint256` (external)

### `rateStalePeriod() → uint256` (external)

### `exchangeFeeRate(bytes32 currencyKey) → uint256` (external)

### `minimumStakeTime() → uint256` (external)

### `debtSnapshotStaleTime() → uint256` (external)

### `aggregatorWarningFlags() → address` (external)

### `tradingRewardsEnabled() → bool` (external)

### `crossDomainMessageGasLimit(enum MixinSystemSettings.CrossDomainMessageGasLimits gasLimitType) → uint256` (external)

### `setCrossDomainMessageGasLimit(enum MixinSystemSettings.CrossDomainMessageGasLimits _gasLimitType, uint256 _crossDomainMessageGasLimit)` (external)

### `setTradingRewardsEnabled(bool _tradingRewardsEnabled)` (external)

### `setWaitingPeriodSecs(uint256 _waitingPeriodSecs)` (external)

### `setPriceDeviationThresholdFactor(uint256 _priceDeviationThresholdFactor)` (external)

### `setIssuanceRatio(uint256 _issuanceRatio)` (external)

### `setFeePeriodDuration(uint256 _feePeriodDuration)` (external)

### `setTargetThreshold(uint256 _percent)` (external)

### `setLiquidationDelay(uint256 time)` (external)

### `setLiquidationRatio(uint256 _liquidationRatio)` (external)

### `setLiquidationPenalty(uint256 penalty)` (external)

### `setRateStalePeriod(uint256 period)` (external)

### `setExchangeFeeRateForPynths(bytes32[] pynthKeys, uint256[] exchangeFeeRates)` (external)

### `setMinimumStakeTime(uint256 _seconds)` (external)

### `setDebtSnapshotStaleTime(uint256 _seconds)` (external)

### `setAggregatorWarningFlags(address _flags)` (external)

### `CrossDomainMessageGasLimitChanged(enum MixinSystemSettings.CrossDomainMessageGasLimits gasLimitType, uint256 newLimit)`

### `TradingRewardsEnabled(bool enabled)`

### `WaitingPeriodSecsUpdated(uint256 waitingPeriodSecs)`

### `PriceDeviationThresholdUpdated(uint256 threshold)`

### `IssuanceRatioUpdated(uint256 newRatio)`

### `FeePeriodDurationUpdated(uint256 newFeePeriodDuration)`

### `TargetThresholdUpdated(uint256 newTargetThreshold)`

### `LiquidationDelayUpdated(uint256 newDelay)`

### `LiquidationRatioUpdated(uint256 newRatio)`

### `LiquidationPenaltyUpdated(uint256 newPenalty)`

### `RateStalePeriodUpdated(uint256 rateStalePeriod)`

### `ExchangeFeeUpdated(bytes32 pynthKey, uint256 newExchangeFeeRate)`

### `MinimumStakeTimeUpdated(uint256 minimumStakeTime)`

### `DebtSnapshotStaleTimeUpdated(uint256 debtSnapshotStaleTime)`

### `AggregatorWarningFlagsUpdated(address flags)`
