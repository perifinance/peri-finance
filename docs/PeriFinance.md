## `PeriFinance`

### `constructor(address payable _proxy, contract TokenState _tokenState, address _owner, uint256 _totalSupply, address _resolver)` (public)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `rewardEscrow() → contract IRewardEscrow` (internal)

### `rewardEscrowV2() → contract IRewardEscrowV2` (internal)

### `supplySchedule() → contract ISupplySchedule` (internal)

### `exchangeWithVirtual(bytes32 sourceCurrencyKey, uint256 sourceAmount, bytes32 destinationCurrencyKey, bytes32 trackingCode) → uint256 amountReceived, contract IVirtualPynth vPynth` (external)

### `settle(bytes32 currencyKey) → uint256 reclaimed, uint256 refunded, uint256 numEntriesSettled` (external)

### `mint() → bool` (external)

### `liquidateDelinquentAccount(address account, uint256 pusdAmount) → bool` (external)

### `migrateEscrowBalanceToRewardEscrowV2()` (external)

### `emitAccountLiquidated(address account, uint256 periRedeemed, uint256 amountLiquidated, address liquidator)` (internal)

### `AccountLiquidated(address account, uint256 periRedeemed, uint256 amountLiquidated, address liquidator)`
