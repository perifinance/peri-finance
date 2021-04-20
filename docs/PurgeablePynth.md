## `PurgeablePynth`

### `constructor(address payable _proxy, contract TokenState _tokenState, string _tokenName, string _tokenSymbol, address payable _owner, bytes32 _currencyKey, uint256 _totalSupply, address _resolver)` (public)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `exchangeRates() → contract IExchangeRates` (internal)

### `purge(address[] addresses)` (external)

### `emitPurged(address account, uint256 value)` (internal)

### `Purged(address account, uint256 value)`
