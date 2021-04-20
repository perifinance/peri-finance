## `EmptyCollateralManager`

### `hasCollateral(address) → bool` (external)

### `isPynthManaged(bytes32) → bool` (external)

### `long(bytes32) → uint256 amount` (external)

### `short(bytes32) → uint256 amount` (external)

### `totalLong() → uint256 pusdValue, bool anyRateIsInvalid` (external)

### `totalShort() → uint256 pusdValue, bool anyRateIsInvalid` (external)

### `getBorrowRate() → uint256 borrowRate, bool anyRateIsInvalid` (external)

### `getShortRate(bytes32) → uint256 shortRate, bool rateIsInvalid` (external)

### `getRatesAndTime(uint256) → uint256 entryRate, uint256 lastRate, uint256 lastUpdated, uint256 newIndex` (external)

### `getShortRatesAndTime(bytes32, uint256) → uint256 entryRate, uint256 lastRate, uint256 lastUpdated, uint256 newIndex` (external)

### `exceedsDebtLimit(uint256, bytes32) → bool canIssue, bool anyRateIsInvalid` (external)

### `arePynthsAndCurrenciesSet(bytes32[], bytes32[]) → bool` (external)

### `areShortablePynthsSet(bytes32[], bytes32[]) → bool` (external)

### `getNewLoanId() → uint256 id` (external)

### `addCollaterals(address[])` (external)

### `removeCollaterals(address[])` (external)

### `addPynths(bytes32[], bytes32[])` (external)

### `removePynths(bytes32[], bytes32[])` (external)

### `addShortablePynths(bytes32[2][], bytes32[])` (external)

### `removeShortablePynths(bytes32[])` (external)

### `updateBorrowRates(uint256)` (external)

### `updateShortRates(bytes32, uint256)` (external)

### `incrementLongs(bytes32, uint256)` (external)

### `decrementLongs(bytes32, uint256)` (external)

### `incrementShorts(bytes32, uint256)` (external)

### `decrementShorts(bytes32, uint256)` (external)
