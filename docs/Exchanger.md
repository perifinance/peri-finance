## `Exchanger`

### `onlyPeriFinanceorPynth()`

### `onlyExchangeRates()`

### `constructor(address _owner, address _resolver)` (public)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `systemStatus() → contract ISystemStatus` (internal)

### `exchangeState() → contract IExchangeState` (internal)

### `exchangeRates() → contract IExchangeRates` (internal)

### `periFinance() → contract IPeriFinance` (internal)

### `feePool() → contract IFeePool` (internal)

### `tradingRewards() → contract ITradingRewards` (internal)

### `delegateApprovals() → contract IDelegateApprovals` (internal)

### `issuer() → contract IIssuer` (internal)

### `debtCache() → contract IExchangerInternalDebtCache` (internal)

### `maxSecsLeftInWaitingPeriod(address account, bytes32 currencyKey) → uint256` (public)

### `waitingPeriodSecs() → uint256` (external)

### `tradingRewardsEnabled() → bool` (external)

### `priceDeviationThresholdFactor() → uint256` (external)

### `settlementOwing(address account, bytes32 currencyKey) → uint256 reclaimAmount, uint256 rebateAmount, uint256 numEntries` (public)

### `_settlementOwing(address account, bytes32 currencyKey) → uint256 reclaimAmount, uint256 rebateAmount, uint256 numEntries, struct Exchanger.ExchangeEntrySettlement[]` (internal)

### `_getExchangeEntry(address account, bytes32 currencyKey, uint256 index) → struct IExchangeState.ExchangeEntry` (internal)

### `hasWaitingPeriodOrSettlementOwing(address account, bytes32 currencyKey) → bool` (external)

### `calculateAmountAfterSettlement(address from, bytes32 currencyKey, uint256 amount, uint256 refunded) → uint256 amountAfterSettlement` (public)

### `isPynthRateInvalid(bytes32 currencyKey) → bool` (external)

### `exchange(address from, bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey, address destinationAddress) → uint256 amountReceived` (external)

### `exchangeOnBehalf(address exchangeForAddress, address from, bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey) → uint256 amountReceived` (external)

### `exchangeWithTracking(address from, bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey, address destinationAddress, address originator, bytes32 trackingCode) → uint256 amountReceived` (external)

### `exchangeOnBehalfWithTracking(address exchangeForAddress, address from, bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey, address originator, bytes32 trackingCode) → uint256 amountReceived` (external)

### `exchangeWithVirtual(address from, bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey, address destinationAddress, bytes32 trackingCode) → uint256 amountReceived, contract IVirtualPynth vPynth` (external)

### `_emitTrackingEvent(bytes32 trackingCode, bytes32 toCurrencyKey, uint256 toAmount)` (internal)

### `_processTradingRewards(uint256 fee, address originator)` (internal)

### `_suspendIfRateInvalid(bytes32 currencyKey, uint256 rate) → bool circuitBroken` (internal)

### `_updatePERIIssuedDebtOnExchange(bytes32[2] currencyKeys, uint256[2] currencyRates)` (internal)

### `_settleAndCalcSourceAmountRemaining(uint256 sourceAmount, address from, bytes32 sourceCurrencyKey) → uint256 sourceAmountAfterSettlement` (internal)

### `_exchange(address from, bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey, address destinationAddress, bool virtualPynth) → uint256 amountReceived, uint256 fee, contract IVirtualPynth vPynth` (internal)

### `_convert(bytes32 sourceCurrencyKey, address from, uint256 sourceAmountAfterSettlement, bytes32 destinationCurrencyKey, uint256 amountReceived, address recipient, bool virtualPynth) → contract IVirtualPynth vPynth` (internal)

### `_createVirtualPynth(contract IERC20, address, uint256, bytes32) → contract IVirtualPynth` (internal)

### `settle(address from, bytes32 currencyKey) → uint256 reclaimed, uint256 refunded, uint256 numEntriesSettled` (external)

### `suspendPynthWithInvalidRate(bytes32 currencyKey)` (external)

### `setLastExchangeRateForPynth(bytes32 currencyKey, uint256 rate)` (external)

### `_ensureCanExchange(bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey)` (internal)

### `_isPynthRateInvalid(bytes32 currencyKey, uint256 currentRate) → bool` (internal)

### `_isDeviationAboveThreshold(uint256 base, uint256 comparison) → bool` (internal)

### `_internalSettle(address from, bytes32 currencyKey, bool updateCache) → uint256 reclaimed, uint256 refunded, uint256 numEntriesSettled` (internal)

### `reclaim(address from, bytes32 currencyKey, uint256 amount)` (internal)

### `refund(address from, bytes32 currencyKey, uint256 amount)` (internal)

### `secsLeftInWaitingPeriodForExchange(uint256 timestamp) → uint256` (internal)

### `feeRateForExchange(bytes32 sourceCurrencyKey, bytes32 destinationCurrencyKey) → uint256 exchangeFeeRate` (external)

### `_feeRateForExchange(bytes32 sourceCurrencyKey, bytes32 destinationCurrencyKey) → uint256 exchangeFeeRate` (internal)

### `getAmountsForExchange(uint256 sourceAmount, bytes32 sourceCurrencyKey, bytes32 destinationCurrencyKey) → uint256 amountReceived, uint256 fee, uint256 exchangeFeeRate` (external)

### `_getAmountsForExchangeMinusFees(uint256 sourceAmount, bytes32 sourceCurrencyKey, bytes32 destinationCurrencyKey) → uint256 amountReceived, uint256 fee, uint256 exchangeFeeRate, uint256 sourceRate, uint256 destinationRate` (internal)

### `_getAmountReceivedForExchange(uint256 destinationAmount, uint256 exchangeFeeRate) → uint256 amountReceived` (internal)

### `appendExchange(address account, bytes32 src, uint256 amount, bytes32 dest, uint256 amountReceived, uint256 exchangeFeeRate)` (internal)

### `getRoundIdsAtPeriodEnd(struct IExchangeState.ExchangeEntry exchangeEntry) → uint256 srcRoundIdAtPeriodEnd, uint256 destRoundIdAtPeriodEnd` (internal)

### `ExchangeEntryAppended(address account, bytes32 src, uint256 amount, bytes32 dest, uint256 amountReceived, uint256 exchangeFeeRate, uint256 roundIdForSrc, uint256 roundIdForDest)`

### `ExchangeEntrySettled(address from, bytes32 src, uint256 amount, bytes32 dest, uint256 reclaim, uint256 rebate, uint256 srcRoundIdAtPeriodEnd, uint256 destRoundIdAtPeriodEnd, uint256 exchangeTimestamp)`
