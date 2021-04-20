## `PeriFinanceStateWithLimitedSetup`

### `constructor(address _owner, address _associatedContract)` (public)

### `setFeePool(contract IFeePool _feePool)` (external)

set the FeePool contract as it is the only authority to be able to call
appendVestingEntry with the onlyFeePool modifer

### `importIssuerData(address[] accounts, uint256[] pUSDAmounts)` (external)

### `_addToDebtRegister(address account, uint256 amount)` (internal)

### `FeePoolUpdated(address newFeePool)`
