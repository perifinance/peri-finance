## `PeriFinanceBridgeToOptimism`

### `requireActive()`

### `requireZeroDebt()`

### `constructor(address _owner, address _resolver)` (public)

### `messenger() → contract iOVM_BaseCrossDomainMessenger` (internal)

### `periFinance() → contract IPeriFinance` (internal)

### `periFinanceERC20() → contract IERC20` (internal)

### `issuer() → contract IIssuer` (internal)

### `rewardsDistribution() → address` (internal)

### `rewardEscrowV2() → contract IRewardEscrowV2` (internal)

### `periFinanceBridgeToBase() → address` (internal)

### `isActive()` (internal)

### `hasZeroDebt()` (internal)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `initiateDeposit(uint256 depositAmount)` (external)

### `initiateEscrowMigration(uint256[][] entryIDs)` (public)

### `initiateRewardDeposit(uint256 amount)` (external)

### `completeWithdrawal(address account, uint256 amount)` (external)

### `migrateBridge(address newBridge)` (external)

### `notifyRewardAmount(uint256 amount)` (external)

### `depositAndMigrateEscrow(uint256 depositAmount, uint256[][] entryIDs)` (public)

### `_initiateRewardDeposit(uint256 _amount)` (internal)

### `BridgeMigrated(address oldBridge, address newBridge, uint256 amount)`

### `Deposit(address account, uint256 amount)`

### `ExportedVestingEntries(address account, uint256 escrowedAccountBalance, struct VestingEntries.VestingEntry[] vestingEntries)`

### `RewardDeposit(address account, uint256 amount)`

### `WithdrawalCompleted(address account, uint256 amount)`
