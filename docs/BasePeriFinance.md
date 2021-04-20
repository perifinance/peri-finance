## `BasePeriFinance`

### `systemActive()`

### `issuanceActive()`

### `exchangeActive(bytes32 src, bytes32 dest)`

### `onlyExchanger()`

### `constructor(address payable _proxy, contract TokenState _tokenState, address _owner, uint256 _totalSupply, address _resolver)` (public)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `periFinanceState() → contract IPeriFinanceState` (internal)

### `systemStatus() → contract ISystemStatus` (internal)

### `exchanger() → contract IExchanger` (internal)

### `issuer() → contract IIssuer` (internal)

### `usdcState() → contract IStakeStateUSDC` (internal)

### `rewardsDistribution() → contract IRewardsDistribution` (internal)

### `debtBalanceOf(address account, bytes32 currencyKey) → uint256` (external)

### `totalIssuedPynths(bytes32 currencyKey) → uint256` (external)

### `totalIssuedPynthsExcludeEtherCollateral(bytes32 currencyKey) → uint256` (external)

### `availableCurrencyKeys() → bytes32[]` (external)

### `availablePynthCount() → uint256` (external)

### `availablePynths(uint256 index) → contract IPynth` (external)

### `pynths(bytes32 currencyKey) → contract IPynth` (external)

### `pynthsByAddress(address pynthAddress) → bytes32` (external)

### `isWaitingPeriod(bytes32 currencyKey) → bool` (external)

### `anyPynthOrPERIRateIsInvalid() → bool anyRateInvalid` (external)

### `maxIssuablePynths(address account) → uint256 maxIssuable` (external)

### `remainingIssuablePynths(address account) → uint256 maxIssuable, uint256 alreadyIssued, uint256 totalSystemDebt` (external)

### `collateralisationRatio(address _issuer) → uint256` (external)

### `collateral(address account) → uint256` (external)

### `transferablePeriFinance(address account) → uint256 transferable` (external)

### `_canTransfer(address account, uint256 value) → bool` (internal)

### `setLock(address account, uint256 delay, uint256 iterations, uint256 totalLockAmount, uint256 interval)` (external)

### `resetLock(address account)` (external)

### `getLock(address account) → address, uint256, uint256, uint256, uint256, uint256` (public)

### `getLockCalculation(address account) → uint256, uint256` (public)

### `_isLocked(address account, uint256 amount) → bool` (internal)

### `exchange(bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey) → uint256 amountReceived` (external)

### `exchangeOnBehalf(address exchangeForAddress, bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey) → uint256 amountReceived` (external)

### `settle(bytes32 currencyKey) → uint256 reclaimed, uint256 refunded, uint256 numEntriesSettled` (external)

### `exchangeWithTracking(bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey, address originator, bytes32 trackingCode) → uint256 amountReceived` (external)

### `exchangeOnBehalfWithTracking(address exchangeForAddress, bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey, address originator, bytes32 trackingCode) → uint256 amountReceived` (external)

### `transfer(address to, uint256 value) → bool` (external)

### `transferFrom(address from, address to, uint256 value) → bool` (external)

### `issuePynths(uint256 amount)` (external)

### `issuePynthsOnBehalf(address issueForAddress, uint256 amount)` (external)

### `issueMaxPynths()` (external)

### `issueMaxPynthsOnBehalf(address issueForAddress)` (external)

### `issuePynthsUsdc(uint256 amount)` (external)

### `burnPynths(uint256 amount)` (external)

### `burnPynthsOnBehalf(address burnForAddress, uint256 amount)` (external)

### `burnPynthsToTarget()` (external)

### `burnPynthsToTargetOnBehalf(address burnForAddress)` (external)

### `exchangeWithVirtual(bytes32, uint256, bytes32, bytes32) → uint256, contract IVirtualPynth` (external)

### `mint() → bool` (external)

### `liquidateDelinquentAccount(address, uint256) → bool` (external)

### `mintSecondary(address, uint256)` (external)

### `mintSecondaryRewards(uint256)` (external)

### `burnSecondary(address, uint256)` (external)

### `_notImplemented()` (internal)

### `emitPynthExchange(address account, bytes32 fromCurrencyKey, uint256 fromAmount, bytes32 toCurrencyKey, uint256 toAmount, address toAddress)` (external)

### `emitExchangeTracking(bytes32 trackingCode, bytes32 toCurrencyKey, uint256 toAmount)` (external)

### `emitExchangeReclaim(address account, bytes32 currencyKey, uint256 amount)` (external)

### `emitExchangeRebate(address account, bytes32 currencyKey, uint256 amount)` (external)

### `LockChanged(address account, uint256 startTime, uint256 iterations, uint256 totalAmount, uint256 unitTime, uint256 endTime)`

### `PynthExchange(address account, bytes32 fromCurrencyKey, uint256 fromAmount, bytes32 toCurrencyKey, uint256 toAmount, address toAddress)`

### `ExchangeTracking(bytes32 trackingCode, bytes32 toCurrencyKey, uint256 toAmount)`

### `ExchangeReclaim(address account, bytes32 currencyKey, uint256 amount)`

### `ExchangeRebate(address account, bytes32 currencyKey, uint256 amount)`
