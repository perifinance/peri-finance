## `ICollateralManager`

### `hasCollateral(address collateral) → bool` (external)

### `isPynthManaged(bytes32 currencyKey) → bool` (external)

### `long(bytes32 pynth) → uint256 amount` (external)

### `short(bytes32 pynth) → uint256 amount` (external)

### `totalLong() → uint256 pusdValue, bool anyRateIsInvalid` (external)

### `totalShort() → uint256 pusdValue, bool anyRateIsInvalid` (external)

### `getBorrowRate() → uint256 borrowRate, bool anyRateIsInvalid` (external)

### `getShortRate(bytes32 pynth) → uint256 shortRate, bool rateIsInvalid` (external)

### `getRatesAndTime(uint256 index) → uint256 entryRate, uint256 lastRate, uint256 lastUpdated, uint256 newIndex` (external)

### `getShortRatesAndTime(bytes32 currency, uint256 index) → uint256 entryRate, uint256 lastRate, uint256 lastUpdated, uint256 newIndex` (external)

### `exceedsDebtLimit(uint256 amount, bytes32 currency) → bool canIssue, bool anyRateIsInvalid` (external)

### `arePynthsAndCurrenciesSet(bytes32[] requiredPynthNamesInResolver, bytes32[] pynthKeys) → bool` (external)

### `areShortablePynthsSet(bytes32[] requiredPynthNamesInResolver, bytes32[] pynthKeys) → bool` (external)

### `getNewLoanId() → uint256 id` (external)

### `addCollaterals(address[] collaterals)` (external)

### `removeCollaterals(address[] collaterals)` (external)

### `addPynths(bytes32[] pynthNamesInResolver, bytes32[] pynthKeys)` (external)

### `removePynths(bytes32[] pynths, bytes32[] pynthKeys)` (external)

### `addShortablePynths(bytes32[2][] requiredPynthAndInverseNamesInResolver, bytes32[] pynthKeys)` (external)

### `removeShortablePynths(bytes32[] pynths)` (external)

### `updateBorrowRates(uint256 rate)` (external)

### `updateShortRates(bytes32 currency, uint256 rate)` (external)

### `incrementLongs(bytes32 pynth, uint256 amount)` (external)

### `decrementLongs(bytes32 pynth, uint256 amount)` (external)

### `incrementShorts(bytes32 pynth, uint256 amount)` (external)

### `decrementShorts(bytes32 pynth, uint256 amount)` (external)
