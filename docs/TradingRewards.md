## `TradingRewards`

### `onlyPeriodController()`

### `onlyExchanger()`

### `constructor(address owner, address periodController, address resolver)` (public)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `periFinance() → contract IERC20` (internal)

### `exchanger() → contract IExchanger` (internal)

### `getAvailableRewards() → uint256` (external)

### `getUnassignedRewards() → uint256` (external)

### `getRewardsToken() → address` (external)

### `getPeriodController() → address` (external)

### `getCurrentPeriod() → uint256` (external)

### `getPeriodIsClaimable(uint256 periodID) → bool` (external)

### `getPeriodIsFinalized(uint256 periodID) → bool` (external)

### `getPeriodRecordedFees(uint256 periodID) → uint256` (external)

### `getPeriodTotalRewards(uint256 periodID) → uint256` (external)

### `getPeriodAvailableRewards(uint256 periodID) → uint256` (external)

### `getUnaccountedFeesForAccountForPeriod(address account, uint256 periodID) → uint256` (external)

### `getAvailableRewardsForAccountForPeriod(address account, uint256 periodID) → uint256` (external)

### `getAvailableRewardsForAccountForPeriods(address account, uint256[] periodIDs) → uint256 totalRewards` (external)

### `_calculateRewards(address account, uint256 periodID) → uint256` (internal)

### `claimRewardsForPeriod(uint256 periodID)` (external)

### `claimRewardsForPeriods(uint256[] periodIDs)` (external)

### `_claimRewards(address account, uint256 periodID)` (internal)

### `recordExchangeFeeForAccount(uint256 usdFeeAmount, address account)` (external)

### `closeCurrentPeriodWithRewards(uint256 rewards)` (external)

### `recoverTokens(address tokenAddress, address recoverAddress)` (external)

### `recoverUnassignedRewardTokens(address recoverAddress)` (external)

### `recoverAssignedRewardTokensAndDestroyPeriod(address recoverAddress, uint256 periodID)` (external)

### `_validateRecoverAddress(address recoverAddress)` (internal)

### `setPeriodController(address newPeriodController)` (external)

### `ExchangeFeeRecorded(address account, uint256 amount, uint256 periodID)`

### `RewardsClaimed(address account, uint256 amount, uint256 periodID)`

### `NewPeriodStarted(uint256 periodID)`

### `PeriodFinalizedWithRewards(uint256 periodID, uint256 rewards)`

### `TokensRecovered(address tokenAddress, address recoverAddress, uint256 amount)`

### `UnassignedRewardTokensRecovered(address recoverAddress, uint256 amount)`

### `AssignedRewardTokensRecovered(address recoverAddress, uint256 amount, uint256 periodID)`

### `PeriodControllerChanged(address newPeriodController)`
