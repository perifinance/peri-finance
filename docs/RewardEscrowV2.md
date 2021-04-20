## `RewardEscrowV2`

### `onlyPeriFinanceBridge()`

### `systemActive()`

### `constructor(address _owner, address _resolver)` (public)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `periFinanceBridgeToOptimism() → address` (internal)

### `oldRewardEscrow() → contract IRewardEscrow` (internal)

### `systemStatus() → contract ISystemStatus` (internal)

### `setMigrateEntriesThresholdAmount(uint256 amount)` (external)

### `migrateVestingSchedule(address addressToMigrate)` (external)

### `importVestingSchedule(address[] accounts, uint256[] escrowAmounts)` (external)

Import function for owner to import vesting schedule
All entries imported should have past their vesting timestamp and will be ready to be vested
Addresses with totalEscrowedAccountBalance == 0 will not be migrated as they have all vested

### `migrateAccountEscrowBalances(address[] accounts, uint256[] escrowBalances, uint256[] vestedBalances)` (external)

Migration for owner to migrate escrowed and vested account balances
Addresses with totalEscrowedAccountBalance == 0 will not be migrated as they have all vested

### `_importVestingEntry(address account, struct VestingEntries.VestingEntry entry)` (internal)

### `burnForMigration(address account, uint256[] entryIDs) → uint256 escrowedAccountBalance, struct VestingEntries.VestingEntry[] vestingEntries` (external)

### `MigratedAccountEscrow(address account, uint256 escrowedAmount, uint256 vestedAmount, uint256 time)`

### `ImportedVestingSchedule(address account, uint256 time, uint256 escrowAmount)`

### `BurnedForMigrationToL2(address account, uint256[] entryIDs, uint256 escrowedAmountMigrated, uint256 time)`

### `ImportedVestingEntry(address account, uint256 entryID, uint256 escrowAmount, uint256 endTime)`

### `MigrateEntriesThresholdAmountUpdated(uint256 newAmount)`
