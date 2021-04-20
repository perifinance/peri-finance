## `CollateralManager`

### `onlyCollateral()`

### `constructor(contract CollateralManagerState _state, address _owner, address _resolver, uint256 _maxDebt, uint256 _baseBorrowRate, uint256 _baseShortRate)` (public)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `isPynthManaged(bytes32 currencyKey) → bool` (external)

### `_issuer() → contract IIssuer` (internal)

### `_exchangeRates() → contract IExchangeRates` (internal)

### `_pynth(bytes32 pynthName) → contract IPynth` (internal)

### `hasCollateral(address collateral) → bool` (public)

### `hasAllCollaterals(address[] collaterals) → bool` (public)

### `long(bytes32 pynth) → uint256 amount` (external)

### `short(bytes32 pynth) → uint256 amount` (external)

### `totalLong() → uint256 pusdValue, bool anyRateIsInvalid` (public)

### `totalShort() → uint256 pusdValue, bool anyRateIsInvalid` (public)

### `getBorrowRate() → uint256 borrowRate, bool anyRateIsInvalid` (external)

### `getShortRate(bytes32 pynth) → uint256 shortRate, bool rateIsInvalid` (external)

### `getRatesAndTime(uint256 index) → uint256 entryRate, uint256 lastRate, uint256 lastUpdated, uint256 newIndex` (external)

### `getShortRatesAndTime(bytes32 currency, uint256 index) → uint256 entryRate, uint256 lastRate, uint256 lastUpdated, uint256 newIndex` (external)

### `exceedsDebtLimit(uint256 amount, bytes32 currency) → bool canIssue, bool anyRateIsInvalid` (external)

### `setUtilisationMultiplier(uint256 _utilisationMultiplier)` (public)

### `setMaxDebt(uint256 _maxDebt)` (public)

### `setBaseBorrowRate(uint256 _baseBorrowRate)` (public)

### `setBaseShortRate(uint256 _baseShortRate)` (public)

### `getNewLoanId() → uint256 id` (external)

### `addCollaterals(address[] collaterals)` (external)

### `removeCollaterals(address[] collaterals)` (external)

### `addPynths(bytes32[] pynthNamesInResolver, bytes32[] pynthKeys)` (external)

### `arePynthsAndCurrenciesSet(bytes32[] requiredPynthNamesInResolver, bytes32[] pynthKeys) → bool` (external)

### `removePynths(bytes32[] pynths, bytes32[] pynthKeys)` (external)

### `addShortablePynths(bytes32[2][] requiredPynthAndInverseNamesInResolver, bytes32[] pynthKeys)` (external)

### `areShortablePynthsSet(bytes32[] requiredPynthNamesInResolver, bytes32[] pynthKeys) → bool` (external)

### `removeShortablePynths(bytes32[] pynths)` (external)

### `updateBorrowRates(uint256 rate)` (external)

### `updateShortRates(bytes32 currency, uint256 rate)` (external)

### `incrementLongs(bytes32 pynth, uint256 amount)` (external)

### `decrementLongs(bytes32 pynth, uint256 amount)` (external)

### `incrementShorts(bytes32 pynth, uint256 amount)` (external)

### `decrementShorts(bytes32 pynth, uint256 amount)` (external)

### `MaxDebtUpdated(uint256 maxDebt)`

### `LiquidationPenaltyUpdated(uint256 liquidationPenalty)`

### `BaseBorrowRateUpdated(uint256 baseBorrowRate)`

### `BaseShortRateUpdated(uint256 baseShortRate)`

### `CollateralAdded(address collateral)`

### `CollateralRemoved(address collateral)`

### `PynthAdded(bytes32 pynth)`

### `PynthRemoved(bytes32 pynth)`

### `ShortablePynthAdded(bytes32 pynth)`

### `ShortablePynthRemoved(bytes32 pynth)`
