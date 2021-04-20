## `Pynth`

### `onlyInternalContracts()`

### `constructor(address payable _proxy, contract TokenState _tokenState, string _tokenName, string _tokenSymbol, address _owner, bytes32 _currencyKey, uint256 _totalSupply, address _resolver)` (public)

### `transfer(address to, uint256 value) → bool` (public)

### `transferAndSettle(address to, uint256 value) → bool` (public)

### `transferFrom(address from, address to, uint256 value) → bool` (public)

### `transferFromAndSettle(address from, address to, uint256 value) → bool` (public)

### `_transferToFeeAddress(address to, uint256 value) → bool` (internal)

\_transferToFeeAddress function
non-pUSD pynths are exchanged into pUSD via pynthInitiatedExchange
notify feePool to record amount as fee paid to feePool

### `issue(address account, uint256 amount)` (external)

### `burn(address account, uint256 amount)` (external)

### `_internalIssue(address account, uint256 amount)` (internal)

### `_internalBurn(address account, uint256 amount) → bool` (internal)

### `setTotalSupply(uint256 amount)` (external)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `systemStatus() → contract ISystemStatus` (internal)

### `feePool() → contract IFeePool` (internal)

### `exchanger() → contract IExchanger` (internal)

### `issuer() → contract IIssuer` (internal)

### `_ensureCanTransfer(address from, uint256 value)` (internal)

### `transferablePynths(address account) → uint256` (public)

### `_internalTransferFrom(address from, address to, uint256 value) → bool` (internal)

### `emitIssued(address account, uint256 value)` (internal)

### `emitBurned(address account, uint256 value)` (internal)

### `Issued(address account, uint256 value)`

### `Burned(address account, uint256 value)`
