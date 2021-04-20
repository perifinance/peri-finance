## `CollateralErc20`

### `constructor(contract CollateralState _state, address _owner, address _manager, address _resolver, bytes32 _collateralKey, uint256 _minCratio, uint256 _minCollateral, address _underlyingContract, uint256 _underlyingDecimals)` (public)

### `open(uint256 collateral, uint256 amount, bytes32 currency)` (external)

### `close(uint256 id)` (external)

### `deposit(address borrower, uint256 id, uint256 amount)` (external)

### `withdraw(uint256 id, uint256 amount)` (external)

### `repay(address borrower, uint256 id, uint256 amount)` (external)

### `draw(uint256 id, uint256 amount)` (external)

### `liquidate(address borrower, uint256 id, uint256 amount)` (external)

### `scaleUpCollateral(uint256 collateral) → uint256 scaledUp` (public)

### `scaleDownCollateral(uint256 collateral) → uint256 scaledDown` (public)
