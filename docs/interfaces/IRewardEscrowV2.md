## `IRewardEscrowV2`

### `balanceOf(address account) → uint256` (external)

### `numVestingEntries(address account) → uint256` (external)

### `totalEscrowedAccountBalance(address account) → uint256` (external)

### `totalVestedAccountBalance(address account) → uint256` (external)

### `getVestingQuantity(address account, uint256[] entryIDs) → uint256` (external)

### `getVestingSchedules(address account, uint256 index, uint256 pageSize) → struct VestingEntries.VestingEntryWithID[]` (external)

### `getAccountVestingEntryIDs(address account, uint256 index, uint256 pageSize) → uint256[]` (external)

### `getVestingEntryClaimable(address account, uint256 entryID) → uint256` (external)

### `getVestingEntry(address account, uint256 entryID) → uint64, uint256` (external)

### `vest(uint256[] entryIDs)` (external)

### `createEscrowEntry(address beneficiary, uint256 deposit, uint256 duration)` (external)

### `appendVestingEntry(address account, uint256 quantity, uint256 duration)` (external)

### `migrateVestingSchedule(address _addressToMigrate)` (external)

### `migrateAccountEscrowBalances(address[] accounts, uint256[] escrowBalances, uint256[] vestedBalances)` (external)

### `startMergingWindow()` (external)

### `mergeAccount(address accountToMerge, uint256[] entryIDs)` (external)

### `nominateAccountToMerge(address account)` (external)

### `accountMergingIsOpen() → bool` (external)

### `importVestingEntries(address account, uint256 escrowedAmount, struct VestingEntries.VestingEntry[] vestingEntries)` (external)

### `burnForMigration(address account, uint256[] entryIDs) → uint256 escrowedAccountBalance, struct VestingEntries.VestingEntry[] vestingEntries` (external)
