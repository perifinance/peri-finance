## `CollateralEth`

### `constructor(contract CollateralState _state, address _owner, address _manager, address _resolver, bytes32 _collateralKey, uint256 _minCratio, uint256 _minCollateral)` (public)

### `open(uint256 amount, bytes32 currency)` (external)

### `close(uint256 id)` (external)

### `deposit(address borrower, uint256 id)` (external)

### `withdraw(uint256 id, uint256 withdrawAmount)` (external)

### `repay(address account, uint256 id, uint256 amount)` (external)

### `draw(uint256 id, uint256 amount)` (external)

### `liquidate(address borrower, uint256 id, uint256 amount)` (external)

### `claim(uint256 amount)` (external)
