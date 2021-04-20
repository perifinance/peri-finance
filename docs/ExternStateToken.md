## `ExternStateToken`

### `constructor(address payable _proxy, contract TokenState _tokenState, string _name, string _symbol, uint256 _totalSupply, uint8 _decimals, address _owner)` (public)

### `allowance(address owner, address spender) → uint256` (public)

Returns the ERC20 allowance of one party to spend on behalf of another.

### `balanceOf(address account) → uint256` (external)

Returns the ERC20 token balance of a given account.

### `setTokenState(contract TokenState _tokenState)` (external)

Set the address of the TokenState contract.

This can be used to "pause" transfer functionality, by pointing the tokenState at 0x000..
as balances would be unreachable.

### `_internalTransfer(address from, address to, uint256 value) → bool` (internal)

### `_transferByProxy(address from, address to, uint256 value) → bool` (internal)

Perform an ERC20 token transfer. Designed to be called by transfer functions possessing
the onlyProxy or optionalProxy modifiers.

### `_transferFromByProxy(address sender, address from, address to, uint256 value) → bool` (internal)

### `approve(address spender, uint256 value) → bool` (public)

Approves spender to transfer on the message sender's behalf.

### `addressToBytes32(address input) → bytes32` (internal)

### `emitTransfer(address from, address to, uint256 value)` (internal)

### `emitApproval(address owner, address spender, uint256 value)` (internal)

### `emitTokenStateUpdated(address newTokenState)` (internal)

### `Transfer(address from, address to, uint256 value)`

### `Approval(address owner, address spender, uint256 value)`

### `TokenStateUpdated(address newTokenState)`
