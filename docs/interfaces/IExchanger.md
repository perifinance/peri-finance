## `IExchanger`

### `calculateAmountAfterSettlement(address from, bytes32 currencyKey, uint256 amount, uint256 refunded) → uint256 amountAfterSettlement` (external)

### `isPynthRateInvalid(bytes32 currencyKey) → bool` (external)

### `maxSecsLeftInWaitingPeriod(address account, bytes32 currencyKey) → uint256` (external)

### `settlementOwing(address account, bytes32 currencyKey) → uint256 reclaimAmount, uint256 rebateAmount, uint256 numEntries` (external)

### `hasWaitingPeriodOrSettlementOwing(address account, bytes32 currencyKey) → bool` (external)

### `feeRateForExchange(bytes32 sourceCurrencyKey, bytes32 destinationCurrencyKey) → uint256 exchangeFeeRate` (external)

### `getAmountsForExchange(uint256 sourceAmount, bytes32 sourceCurrencyKey, bytes32 destinationCurrencyKey) → uint256 amountReceived, uint256 fee, uint256 exchangeFeeRate` (external)

### `priceDeviationThresholdFactor() → uint256` (external)

### `waitingPeriodSecs() → uint256` (external)

### `exchange(address from, bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey, address destinationAddress) → uint256 amountReceived` (external)

### `exchangeOnBehalf(address exchangeForAddress, address from, bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey) → uint256 amountReceived` (external)

### `exchangeWithTracking(address from, bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey, address destinationAddress, address originator, bytes32 trackingCode) → uint256 amountReceived` (external)

### `exchangeOnBehalfWithTracking(address exchangeForAddress, address from, bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey, address originator, bytes32 trackingCode) → uint256 amountReceived` (external)

### `exchangeWithVirtual(address from, bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey, address destinationAddress, bytes32 trackingCode) → uint256 amountReceived, contract IVirtualPynth vPynth` (external)

### `settle(address from, bytes32 currencyKey) → uint256 reclaimed, uint256 refunded, uint256 numEntries` (external)

### `setLastExchangeRateForPynth(bytes32 currencyKey, uint256 rate)` (external)

### `suspendPynthWithInvalidRate(bytes32 currencyKey)` (external)
