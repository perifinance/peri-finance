## `PeriFinanceEscrow`

### `constructor(address _owner, contract IPeriFinance _periFinance)` (public)

### `setPeriFinance(contract IPeriFinance _periFinance)` (external)

### `balanceOf(address account) → uint256` (public)

A simple alias to totalVestedAccountBalance: provides ERC20 balance integration.

### `numVestingEntries(address account) → uint256` (public)

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

### `purgeAccount(address account)` (external)

Destroy the vesting information associated with an account.

### `appendVestingEntry(address account, uint256 time, uint256 quantity)` (public)

Add a new vesting entry at a given time and quantity to an account's schedule.

A call to this should be accompanied by either enough balance already available
in this contract, or a corresponding call to periFinance.endow(), to ensure that when
the funds are withdrawn, there is enough balance, as well as correctly calculating
the fees.
This may only be called by the owner during the contract's setup period.
Note; although this function could technically be used to produce unbounded
arrays, it's only in the foundation's command to add to these lists.

### `addVestingSchedule(address account, uint256[] times, uint256[] quantities)` (external)

Construct a vesting schedule to release a quantities of PERI
over a series of intervals.

Assumes that the quantities are nonzero
and that the sequence of timestamps is strictly increasing.
This may only be called by the owner during the contract's setup period.

### `vest()` (external)

Allow a user to withdraw any PERI in their schedule that have vested.

### `PeriFinanceUpdated(address newPeriFinance)`

### `Vested(address beneficiary, uint256 time, uint256 value)`
