## `BaseRewardEscrowV2`

### `onlyFeePool()`

### `constructor(address _owner, address _resolver)` (public)

### `feePool() → contract IFeePool` (internal)

### `periFinance() → contract IPeriFinance` (internal)

### `issuer() → contract IIssuer` (internal)

### `_notImplemented()` (internal)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `balanceOf(address account) → uint256` (public)

A simple alias to totalEscrowedAccountBalance: provides ERC20 balance integration.

### `numVestingEntries(address account) → uint256` (external)

The number of vesting dates in an account's schedule.

### `getVestingEntry(address account, uint256 entryID) → uint64 endTime, uint256 escrowAmount` (external)

Get a particular schedule entry for an account.

### `getVestingSchedules(address account, uint256 index, uint256 pageSize) → struct VestingEntries.VestingEntryWithID[]` (external)

### `getAccountVestingEntryIDs(address account, uint256 index, uint256 pageSize) → uint256[]` (external)

### `getVestingQuantity(address account, uint256[] entryIDs) → uint256 total` (external)

### `getVestingEntryClaimable(address account, uint256 entryID) → uint256` (external)

### `_claimableAmount(struct VestingEntries.VestingEntry _entry) → uint256` (internal)

### `vest(uint256[] entryIDs)` (external)

Vest escrowed amounts that are claimable
Allows users to vest their vesting entries based on msg.sender

### `createEscrowEntry(address beneficiary, uint256 deposit, uint256 duration)` (external)

Create an escrow entry to lock PERI for a given duration in seconds

This call expects that the depositor (msg.sender) has already approved the Reward escrow contract
to spend the the amount being escrowed.

### `appendVestingEntry(address account, uint256 quantity, uint256 duration)` (external)

Add a new vesting entry at a given time and quantity to an account's schedule.

A call to this should accompany a previous successful call to periFinance.transfer(rewardEscrow, amount),
to ensure that when the funds are withdrawn, there is enough balance.

### `_transferVestedTokens(address _account, uint256 _amount)` (internal)

### `_reduceAccountEscrowBalances(address _account, uint256 _amount)` (internal)

### `accountMergingIsOpen() → bool` (public)

### `startMergingWindow()` (external)

### `setAccountMergingDuration(uint256 duration)` (external)

### `setMaxAccountMergingWindow(uint256 duration)` (external)

### `setMaxEscrowDuration(uint256 duration)` (external)

### `nominateAccountToMerge(address account)` (external)

### `mergeAccount(address accountToMerge, uint256[] entryIDs)` (external)

### `_addVestingEntry(address account, struct VestingEntries.VestingEntry entry) → uint256` (internal)

### `migrateVestingSchedule(address)` (external)

### `migrateAccountEscrowBalances(address[], uint256[], uint256[])` (external)

### `burnForMigration(address, uint256[]) → uint256, struct VestingEntries.VestingEntry[]` (external)

### `importVestingEntries(address, uint256, struct VestingEntries.VestingEntry[])` (external)

### `_appendVestingEntry(address account, uint256 quantity, uint256 duration)` (internal)

### `Vested(address beneficiary, uint256 time, uint256 value)`

### `VestingEntryCreated(address beneficiary, uint256 time, uint256 value, uint256 duration, uint256 entryID)`

### `MaxEscrowDurationUpdated(uint256 newDuration)`

### `MaxAccountMergingDurationUpdated(uint256 newDuration)`

### `AccountMergingDurationUpdated(uint256 newDuration)`

### `AccountMergingStarted(uint256 time, uint256 endTime)`

### `AccountMerged(address accountToMerge, address destinationAddress, uint256 escrowAmountMerged, uint256[] entryIDs, uint256 time)`

### `NominateAccountToMerge(address account, address destination)`
