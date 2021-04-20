## `MultiCollateralPynth`

### `onlyInternalContracts()`

### `constructor(address payable _proxy, contract TokenState _tokenState, string _tokenName, string _tokenSymbol, address _owner, bytes32 _currencyKey, uint256 _totalSupply, address _resolver)` (public)

### `collateralManager() → contract ICollateralManager` (internal)

### `etherCollateral() → contract IEtherCollateral` (internal)

### `etherCollateralpUSD() → contract IEtherCollateralpUSD` (internal)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `issue(address account, uint256 amount)` (external)

Function that allows multi Collateral to issue a certain number of pynths from an account.

### `burn(address account, uint256 amount)` (external)

Function that allows multi Collateral to burn a certain number of pynths from an account.
