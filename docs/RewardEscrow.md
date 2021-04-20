## `RewardEscrow`

### `onlyFeePool()`

### `constructor(address _owner, contract IPeriFinance _periFinance, contract IFeePool _feePool)` (public)

### `setPeriFinance(contract IPeriFinance _periFinance)` (external)

set the periFinance contract address as we need to transfer PERI when the user vests

### `setFeePool(contract IFeePool _feePool)` (external)

set the FeePool contract as it is the only authority to be able to call
appendVestingEntry with the onlyFeePool modifer

### `balanceOf(address account) → uint256` (public)

A simple alias to totalEscrowedAccountBalance: provides ERC20 balance integration.

### `_numVestingEntries(address account) → uint256` (internal)

### `numVestingEntries(address account) → uint256` (external)

The number of vesting dates in an account's schedule.

### `getVestingScheduleEntry(address account, uint256 index) → uint256[2]` (public)

Get a particular schedule entry for an account.

### `getVestingTime(address account, uint256 index) → uint256` (public)

Get the time at which a given schedule entry will vest.

### `getVestingQuantity(address account, uint256 index) → uint256` (public)

Get the quantity of PERI associated with a given schedule entry.

### `getNextVestingIndex(address account) → uint256` (public)

Obtain the index of the next schedule entry that will vest for a given user.

### `getNextVestingEntry(address account) → uint256[2]` (public)

Obtain the next schedule entry that will vest for a given user.

### `getNextVestingTime(address account) → uint256` (external)

Obtain the time at which the next schedule entry will vest for a given user.

### `getNextVestingQuantity(address account) → uint256` (external)

Obtain the quantity which the next schedule entry will vest for a given user.

### `checkAccountSchedule(address account) → uint256[520]` (public)

return the full vesting schedule entries vest for a given user.

For DApps to display the vesting schedule for the
inflationary supply over 5 years. Solidity cant return variable length arrays
so this is returning pairs of data. Vesting Time at [0] and quantity at [1] and so on

### `_appendVestingEntry(address account, uint256 quantity)` (internal)

### `appendVestingEntry(address account, uint256 quantity)` (external)

Add a new vesting entry at a given time and quantity to an account's schedule.

A call to this should accompany a previous successful call to periFinance.transfer(rewardEscrow, amount),
to ensure that when the funds are withdrawn, there is enough balance.
Note; although this function could technically be used to produce unbounded
arrays, it's only withinn the 4 year period of the weekly inflation schedule.

### `vest()` (external)

Allow a user to withdraw any PERI in their schedule that have vested.

### `PeriFinanceUpdated(address newPeriFinance)`

### `FeePoolUpdated(address newFeePool)`

### `Vested(address beneficiary, uint256 time, uint256 value)`

### `VestingEntryCreated(address beneficiary, uint256 time, uint256 value)`
