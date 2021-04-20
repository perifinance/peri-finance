## `IPeriFinance`

### `anyPynthOrPERIRateIsInvalid() → bool anyRateInvalid` (external)

### `availableCurrencyKeys() → bytes32[]` (external)

### `availablePynthCount() → uint256` (external)

### `availablePynths(uint256 index) → contract IPynth` (external)

### `collateral(address account) → uint256` (external)

### `collateralisationRatio(address issuer) → uint256` (external)

### `debtBalanceOf(address issuer, bytes32 currencyKey) → uint256` (external)

### `isWaitingPeriod(bytes32 currencyKey) → bool` (external)

### `maxIssuablePynths(address issuer) → uint256 maxIssuable` (external)

### `remainingIssuablePynths(address issuer) → uint256 maxIssuable, uint256 alreadyIssued, uint256 totalSystemDebt` (external)

### `pynths(bytes32 currencyKey) → contract IPynth` (external)

### `pynthsByAddress(address pynthAddress) → bytes32` (external)

### `totalIssuedPynths(bytes32 currencyKey) → uint256` (external)

### `totalIssuedPynthsExcludeEtherCollateral(bytes32 currencyKey) → uint256` (external)

### `transferablePeriFinance(address account) → uint256 transferable` (external)

### `burnPynths(uint256 amount)` (external)

### `burnPynthsOnBehalf(address burnForAddress, uint256 amount)` (external)

### `burnPynthsToTarget()` (external)

### `burnPynthsToTargetOnBehalf(address burnForAddress)` (external)

### `exchange(bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey) → uint256 amountReceived` (external)

### `exchangeOnBehalf(address exchangeForAddress, bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey) → uint256 amountReceived` (external)

### `exchangeWithTracking(bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey, address originator, bytes32 trackingCode) → uint256 amountReceived` (external)

### `exchangeOnBehalfWithTracking(address exchangeForAddress, bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey, address originator, bytes32 trackingCode) → uint256 amountReceived` (external)

### `exchangeWithVirtual(bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey, bytes32 trackingCode) → uint256 amountReceived, contract IVirtualPynth vPynth` (external)

### `issueMaxPynths()` (external)

### `issueMaxPynthsOnBehalf(address issueForAddress)` (external)

### `issuePynths(uint256 amount)` (external)

### `issuePynthsOnBehalf(address issueForAddress, uint256 amount)` (external)

### `issuePynthsUsdc(uint256 amount)` (external)

### `mint() → bool` (external)

### `settle(bytes32 currencyKey) → uint256 reclaimed, uint256 refunded, uint256 numEntries` (external)

### `liquidateDelinquentAccount(address account, uint256 pusdAmount) → bool` (external)

### `mintSecondary(address account, uint256 amount)` (external)

### `mintSecondaryRewards(uint256 amount)` (external)

### `burnSecondary(address account, uint256 amount)` (external)
