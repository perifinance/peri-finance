## `ITradingRewards`

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

### `claimRewardsForPeriod(uint256 periodID)` (external)

### `claimRewardsForPeriods(uint256[] periodIDs)` (external)

### `recordExchangeFeeForAccount(uint256 usdFeeAmount, address account)` (external)

### `closeCurrentPeriodWithRewards(uint256 rewards)` (external)

### `recoverTokens(address tokenAddress, address recoverAddress)` (external)

### `recoverUnassignedRewardTokens(address recoverAddress)` (external)

### `recoverAssignedRewardTokensAndDestroyPeriod(address recoverAddress, uint256 periodID)` (external)

### `setPeriodController(address newPeriodController)` (external)
