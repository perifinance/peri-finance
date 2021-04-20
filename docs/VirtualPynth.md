## `VirtualPynth`

### `constructor(contract IERC20 _pynth, contract IAddressResolver _resolver, address _recipient, uint256 _amount, bytes32 _currencyKey)` (public)

### `exchanger() → contract IExchanger` (internal)

### `secsLeft() → uint256` (internal)

### `calcRate() → uint256` (internal)

### `balanceUnderlying(address account) → uint256` (internal)

### `settlePynth()` (internal)

### `name() → string` (external)

### `symbol() → string` (external)

### `rate() → uint256` (external)

### `balanceOfUnderlying(address account) → uint256` (external)

### `secsLeftInWaitingPeriod() → uint256` (external)

### `readyToSettle() → bool` (external)

### `settle(address account)` (external)

### `Settled(uint256 totalSupply, uint256 amountAfterSettled)`
