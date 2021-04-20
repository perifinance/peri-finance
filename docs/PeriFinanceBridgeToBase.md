## `PeriFinanceBridgeToBase`

### `onlyOptimismBridge()`

### `constructor(address _owner, address _resolver)` (public)

### `messenger() → contract iOVM_BaseCrossDomainMessenger` (internal)

### `periFinance() → contract IPeriFinance` (internal)

### `rewardEscrowV2() → contract IRewardEscrowV2` (internal)

### `periFinanceBridgeToOptimism() → address` (internal)

### `onlyAllowFromOptimism()` (internal)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `initiateWithdrawal(uint256 amount)` (external)

### `completeEscrowMigration(address account, uint256 escrowedAmount, struct VestingEntries.VestingEntry[] vestingEntries)` (external)

### `completeDeposit(address account, uint256 depositAmount)` (external)

### `completeRewardDeposit(uint256 amount)` (external)

### `ImportedVestingEntries(address account, uint256 escrowedAmount, struct VestingEntries.VestingEntry[] vestingEntries)`

### `MintedSecondary(address account, uint256 amount)`

### `MintedSecondaryRewards(uint256 amount)`

### `WithdrawalInitiated(address account, uint256 amount)`
