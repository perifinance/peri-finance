## `FeePoolState`

### `onlyFeePool()`

### `constructor(address _owner, contract IFeePool _feePool)` (public)

### `setFeePool(contract IFeePool _feePool)` (external)

set the FeePool contract as it is the only authority to be able to call
appendAccountIssuanceRecord with the onlyFeePool modifer

Must be set by owner when FeePool logic is upgraded

### `getAccountsDebtEntry(address account, uint256 index) → uint256 debtPercentage, uint256 debtEntryIndex` (public)

Get an accounts issuanceData for

### `applicableIssuanceData(address account, uint256 closingDebtIndex) → uint256, uint256` (external)

Find the oldest debtEntryIndex for the corresponding closingDebtIndex

### `appendAccountIssuanceRecord(address account, uint256 debtRatio, uint256 debtEntryIndex, uint256 currentPeriodStartDebtIndex)` (external)

Logs an accounts issuance data in the current fee period which is then stored historically

onlyFeePool to call me on periFinance.issue() & periFinance.burn() calls to store the locked PERI
per fee period so we know to allocate the correct proportions of fees and rewards per period
accountIssuanceLedger[account][0] has the latest locked amount for the current period. This can be update as many time
accountIssuanceLedger[account][1-2] has the last locked amount for a previous period they minted or burned

### `importIssuerData(address[] accounts, uint256[] ratios, uint256 periodToInsert, uint256 feePeriodCloseIndex)` (external)

Import issuer data from periFinanceState.issuerData on FeePeriodClose() block #

Only callable by the contract owner, and only for 6 weeks after deployment.

### `IssuanceDebtRatioEntry(address account, uint256 debtRatio, uint256 feePeriodCloseIndex)`
